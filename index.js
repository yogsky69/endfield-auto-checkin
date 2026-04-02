import { launch } from 'puppeteer';
import 'dotenv/config';
import { mkdir, rm } from 'node:fs/promises';
import crypto from 'node:crypto';

const SIGN_IN_URL = 'https://game.skport.com/endfield/sign-in';
const SIGN_IN_API_URL = 'https://web-api.skport.com/cookie_store/account_token';
const BINDING_LIST_API_URL = 'https://binding-api-account-prod.gryphline.com/account/binding/v1/binding_list';
const EMAIL_SELECTOR = 'form input[name="email"]';
const PASSWORD_SELECTOR = 'form input[type="password"]';
const SUBMIT_SELECTOR = 'form button[type="submit"]';
const IS_HEADLESS = (process.env.PUPPETEER_HEADLESS ?? 'false').toLowerCase() === 'true';
const DISABLE_SANDBOX = (process.env.PUPPETEER_DISABLE_SANDBOX ?? 'false').toLowerCase() === 'true';
const CHROME_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
const USER_DATA_DIR = process.env.PUPPETEER_USER_DATA_DIR ?? './.cache/puppeteer-profile';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15000);
const VALID_REGIONS = new Set(['ASIA', 'AMERICAS', 'EUROPE']);
const REGION_SERVER_MAP = {
    ASIA: '2',
    AMERICAS: '3',
    EUROPE: '3'
};

const urlDict = {
    Endfield: 'https://zonai.skport.com/web/v1/game/endfield/attendance'
};

const headerDict = {
    default: {
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        Referer: 'https://game.skport.com/',
        platform: '3',
        vName: '1.0.0',
        Origin: 'https://game.skport.com',
        Connection: 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        Priority: 'u=0',
        TE: 'trailers'
    }
};

let activeBrowser = null;

function normalizeRegionName(value) {
    return String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function validateRegionInput(region) {
    const normalized = normalizeRegionName(region);
    if (!VALID_REGIONS.has(normalized)) {
        throw new Error('REGION tidak valid. Gunakan salah satu: ASIA, AMERICAS, atau EUROPE.');
    }

    return normalized;
}

function serverByRegion(region) {
    const server = REGION_SERVER_MAP[normalizeRegionName(region)];
    if (!server) {
        throw new Error('REGION tidak valid untuk mapping server. Gunakan ASIA, AMERICAS, atau EUROPE.');
    }

    return server;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getNextRunAtRandomMinute(now = new Date()) {
    const next = new Date(now);
    const randomMinute = Math.floor(Math.random() * 59) + 1;
    next.setDate(next.getDate() + 1);
    next.setHours(1, randomMinute, 0, 0);

    return next;
}

async function closeAllTabsThenBrowser(browser) {
    if (!browser) {
        return;
    }

    const pages = await browser.pages().catch(() => []);
    await Promise.allSettled(
        pages.map(async page => {
            if (!page.isClosed()) {
                await page.close().catch(() => null);
            }
        })
    );

    await browser.close().catch(() => null);
}

async function prepareUserDataDir(profileDir) {
    await mkdir(profileDir, { recursive: true });

    const staleLocks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    await Promise.allSettled(
        staleLocks.map(name => rm(`${profileDir}/${name}`, { force: true }))
    );
}

async function isLoginPrompted(page, tokenResponsePromise) {
    console.log('Memeriksa status login dari API token...');

    const response = tokenResponsePromise
        ? await tokenResponsePromise
        : await page.waitForResponse(
            res => res.url().includes(SIGN_IN_API_URL) && res.request().method() === 'GET',
            { timeout: TIMEOUT_MS }
        ).catch(() => null);

    if (response) {
        const prompted = response.status() === 401;
        console.log(`Status token: ${response.status()} (${prompted ? 'perlu login' : 'sudah login'})`);
        return prompted;
    }

    const formDetected = await page.waitForSelector(EMAIL_SELECTOR, { visible: true, timeout: TIMEOUT_MS }).then(() => true).catch(() => false);
    console.log(`Token API tidak terdeteksi dalam ${TIMEOUT_MS}ms, fallback ke form login: ${formDetected ? 'perlu login' : 'sudah login'}`);
    return formDetected;
}

async function ensureLoggedIn(page, email, password) {
    const tokenResponsePromise = page.waitForResponse(
        res => res.url().includes(SIGN_IN_API_URL) && res.request().method() === 'GET',
        { timeout: TIMEOUT_MS }
    ).catch(() => null);

    await page.goto(SIGN_IN_URL, { waitUntil: 'networkidle2' });

    if (!(await isLoginPrompted(page, tokenResponsePromise))) {
        console.log('Tidak diminta login, lanjut ke check-in.');
        return;
    }

    if (!email || !password) {
        throw new Error('Form login muncul, tetapi email/password kosong.');
    }

    console.log('Form login terdeteksi, melakukan login...');
    await page.waitForSelector(EMAIL_SELECTOR, { visible: true });
    await page.waitForSelector(PASSWORD_SELECTOR, { visible: true });

    await page.click(EMAIL_SELECTOR, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(EMAIL_SELECTOR, email);

    await page.click(PASSWORD_SELECTOR, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(PASSWORD_SELECTOR, password);

    await Promise.all([
        page.click(SUBMIT_SELECTOR),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_MS }).catch(() => null)
    ]);

    if (await page.$('.geetest_box') !== null) {
        throw new Error('Captcha terdeteksi. Skrip ini tidak dapat menangani captcha. Silakan selesaikan captcha secara manual dan jalankan skrip lagi.');
    }
}

function normalizeStorageValue(rawValue) {
    if (rawValue === null || rawValue === undefined) {
        return '';
    }

    const value = String(rawValue).trim();
    if (!value) {
        return '';
    }

    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') {
            return parsed;
        }
    } catch {
        return value;
    }

    return value;
}

async function getLocalStorageAuthKeys(page) {
    const storageResult = await page.evaluate(() => {
        const keys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key) {
                keys.push(key);
            }
        }

        return {
            SK_OAUTH_CRED_KEY: localStorage.getItem('SK_OAUTH_CRED_KEY'),
            SK_TOKEN_CACHE_KEY: localStorage.getItem('SK_TOKEN_CACHE_KEY'),
            keys
        };
    });

    const SK_OAUTH_CRED_KEY = normalizeStorageValue(storageResult.SK_OAUTH_CRED_KEY);
    const SK_TOKEN_CACHE_KEY = normalizeStorageValue(storageResult.SK_TOKEN_CACHE_KEY);

    if (!SK_OAUTH_CRED_KEY || !SK_TOKEN_CACHE_KEY) {
        const keyList = storageResult.keys.length > 0 ? storageResult.keys.join(', ') : '(kosong)';
        throw new Error(`SK_OAUTH_CRED_KEY atau SK_TOKEN_CACHE_KEY tidak ditemukan di localStorage. Keys saat ini: ${keyList}`);
    }

    return { SK_OAUTH_CRED_KEY, SK_TOKEN_CACHE_KEY };
}

function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
        .join('');
}

function generateSign(path, method, headers, query, body, token) {
    let stringToSign = path + (method === 'GET' ? (query || '') : (body || ''));
    if (headers.timestamp) {
        stringToSign += headers.timestamp.toString();
    }

    const headerObj = {};
    ['platform', 'timestamp', 'dId', 'vName'].forEach(key => {
        if (headers[key]) {
            headerObj[key] = headers[key];
        } else if (key === 'dId') {
            headerObj[key] = '';
        }
    });
    stringToSign += JSON.stringify(headerObj);

    const hmac = crypto.createHmac('sha256', token).update(stringToSign).digest();
    const hmacHex = bytesToHex(hmac);
    return crypto.createHash('md5').update(hmacHex, 'utf8').digest('hex');
}

async function autoSignFunction({ SK_OAUTH_CRED_KEY, SK_TOKEN_CACHE_KEY, id, server, language = 'en' }) {
    const path = '/web/v1/game/endfield/attendance';
    const timestamp = String(Math.floor(Date.now() / 1000));

    const headers = {
        ...headerDict.default,
        cred: SK_OAUTH_CRED_KEY,
        'sk-game-role': `3_${id}_${server}`,
        'sk-language': language,
        timestamp
    };
    headers.sign = generateSign(path, 'POST', headers, '', '', SK_TOKEN_CACHE_KEY);

    const httpResponse = await fetch(urlDict.Endfield, {
        method: 'POST',
        headers
    });

    let responseJson = {};
    try {
        responseJson = await httpResponse.json();
    } catch {
        responseJson = { message: `HTTP ${httpResponse.status}` };
    }

    let response = 'Check-in completed';
    if (responseJson.code === 10000) {
        response += '\nEndfield: Token expired!\nPlease update SK_TOKEN_CACHE_KEY in your config.';
    } else {
        const message = responseJson.message ?? `HTTP ${httpResponse.status}`;
        response += `\nEndfield: ${message}`;
    }

    return response;
}

function getRoleIdByRegion(data, region) {
    const normalizedRegion = normalizeRegionName(region);
    const roles = (data?.data?.list ?? []).flatMap(item =>
        (item?.bindingList ?? []).flatMap(binding => binding?.roles ?? [])
    );

    return roles.find(role => {
        const server = String(role?.serverName ?? '').toUpperCase();
        return server.includes(normalizedRegion);
    })?.roleId ?? null;
}

async function getSessionTokenForBindingApi(page) {
    const token = await page.evaluate(() => {
        const values = [];
        for (let i = 0; i < sessionStorage.length; i += 1) {
            const key = sessionStorage.key(i);
            if (!key) {
                continue;
            }

            const value = sessionStorage.getItem(key);
            if (typeof value === 'string' && value.trim()) {
                values.push(value.trim());
            }
        }

        const candidate = values
            .map(value => value.split(':')[0].trim())
            .find(Boolean);

        return candidate ?? '';
    });

    if (!token) {
        throw new Error('Token binding tidak ditemukan di sessionStorage setelah login.');
    }

    return token;
}

async function getRoleIdFromBindingApi(page, region) {
    const token = await getSessionTokenForBindingApi(page);
    const url = `${BINDING_LIST_API_URL}?token=${encodeURIComponent(token)}&appCode=endfield`;
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
        throw new Error(`Gagal mengambil binding_list (HTTP ${response.status}).`);
    }

    const responseJson = await response.json();
    const roleId = getRoleIdByRegion(responseJson, region);

    if (!roleId) {
        throw new Error(`Role ID untuk region ${region} tidak ditemukan pada data binding account.`);
    }

    return String(roleId);
}

async function runSingleCheckin(email, password, region) {
    let browser;
    try {
        await prepareUserDataDir(USER_DATA_DIR);

        const launchArgs = DISABLE_SANDBOX ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

        browser = await launch({
            headless: IS_HEADLESS,
            args: launchArgs,
            userDataDir: USER_DATA_DIR,
            ...(CHROME_EXECUTABLE_PATH ? { executablePath: CHROME_EXECUTABLE_PATH } : {})
        });
        activeBrowser = browser;

        const page = await browser.newPage();
        await ensureLoggedIn(page, email, password);
        await page.goto(SIGN_IN_URL, { waitUntil: 'networkidle2' });
        const roleId = await getRoleIdFromBindingApi(page, region);
        
        console.log(`Akun Region ${region}: ${roleId}`);

        const { SK_OAUTH_CRED_KEY, SK_TOKEN_CACHE_KEY } = await getLocalStorageAuthKeys(page);
        const server = serverByRegion(region);

        return await autoSignFunction({
            SK_OAUTH_CRED_KEY,
            SK_TOKEN_CACHE_KEY,
            id: roleId,
            server,
            language: 'en'
        });
    } finally {
        if (browser) {
            console.log('Menutup semua tab lalu menutup browser...');
            await closeAllTabsThenBrowser(browser);
        }
        activeBrowser = null;
    }
}

async function runDailyCheckin(email, password, region) {
    console.log('Menjalankan check-in awal setelah program dijalankan...');
    const initialCheckinResponse = await runSingleCheckin(email, password, region);
    console.log(initialCheckinResponse);

    while (true) {
        const nextRun = getNextRunAtRandomMinute();
        console.log(`Menunggu check-in berikutnya pada ${nextRun}, sekarang: ${new Date()}`);
        const waitTime = nextRun.getTime() - Date.now();
        if (waitTime > 0) {
            await sleep(waitTime);
        }

        console.log('Menjalankan check-in terjadwal...');
        const scheduledCheckinResponse = await runSingleCheckin(email, password, region);
        console.log(scheduledCheckinResponse);
    }
}

(async () => {
    const email = process.env.SKPORT_EMAIL;
    const password = process.env.SKPORT_PASSWORD;
    const region = process.env.REGION;

    if ((email && !password) || (!email && password)) {
        throw new Error('SKPORT_EMAIL dan SKPORT_PASSWORD harus diisi berpasangan atau kosong keduanya.');
    }

    if (!region) {
        throw new Error('REGION wajib diisi di file .env.');
    }

    const validatedRegion = validateRegionInput(region);

    process.on('SIGINT', async () => {
        console.log('\nMenghentikan script dan menutup browser...');
        if (activeBrowser) {
            await closeAllTabsThenBrowser(activeBrowser);
        }
        process.exit(0);
    });

    try {
        await runDailyCheckin(email, password, validatedRegion);
    } catch (error) {
        throw new Error(`Terjadi kesalahan: ${error.message}`);
    }
})();