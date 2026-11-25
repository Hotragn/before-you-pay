# Real Gemini Nano probe for Before You Pay: headed Chrome stable on Xvfb,
# Prompt API on, drive the live hosted panel's demo store through the
# on-device path. Logs everything, fakes nothing.
import subprocess, os, time, json, shutil, sys, urllib.request
W = '/kaggle/working'; os.makedirs(W, exist_ok=True)
LOG = open(f'{W}/log.txt', 'a')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
def sh(c, check=False):
    r = subprocess.run(c, shell=True, capture_output=True, text=True); log('$', c, '->', r.returncode, (r.stdout + r.stderr)[-1500:]); return r
sh('nproc; free -g; df -h / /tmp /kaggle/working; nvidia-smi || true; uname -a; date -u')
sh('apt-get update -qq && apt-get install -y -qq xvfb ffmpeg wget >/dev/null 2>&1; echo done')
sh('wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y -qq /tmp/chrome.deb >/dev/null 2>&1; google-chrome --version')
sh('pip install -q playwright==1.48.0 2>&1 | tail -1')
os.environ['DISPLAY'] = ':99'
xvfb = subprocess.Popen('Xvfb :99 -screen 0 1920x1080x24', shell=True); time.sleep(2)
# Biggest disk for the profile (needs 22 GB free)
best = max(['/tmp', '/kaggle/working', '/root'], key=lambda p: shutil.disk_usage(p).free if os.path.exists(p) else 0)
PROF = os.path.join(best, 'nano-profile'); os.makedirs(PROF, exist_ok=True)
log('profile on', best, 'free GB', shutil.disk_usage(best).free / 1e9)
json.dump({'internal_only_uis_enabled': True, 'browser': {'enabled_labs_experiments': ['optimization-guide-on-device-model@2', 'prompt-api-for-gemini-nano@1']}}, open(f'{PROF}/Local State', 'w'))
rec = subprocess.Popen(f'ffmpeg -loglevel error -y -f x11grab -video_size 1920x1080 -framerate 10 -i :99 -c:v libx264 -preset ultrafast -pix_fmt yuv420p {W}/screen.mp4', shell=True, stdin=subprocess.PIPE)
chrome = subprocess.Popen(['google-chrome', f'--user-data-dir={PROF}', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--remote-debugging-port=9222', '--window-size=1920,1080', '--window-position=0,0',
  '--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano',
  '--optimization-guide-on-device-model=Enabled', 'about:blank'], stdout=open(f'{W}/chrome-stdout.txt', 'w'), stderr=subprocess.STDOUT)
time.sleep(6)
from playwright.sync_api import sync_playwright
summary = {}
def internals(ctx, name):
    q = ctx.new_page()
    try:
        q.goto('chrome://on-device-internals'); time.sleep(4)
        txt = q.evaluate('document.body.innerText'); open(f'{W}/{name}.txt', 'w').write(txt); q.screenshot(path=f'{W}/{name}.png', full_page=True)
        log('---', name, '---\n', txt[:3000])
    except Exception as e: log('internals error', e)
    q.close()
with sync_playwright() as pw:
    b = pw.chromium.connect_over_cdp('http://127.0.0.1:9222'); ctx = b.contexts[0]
    p = ctx.pages[0] if ctx.pages else ctx.new_page()
    p.on('console', lambda m: log('console:', m.text[:300]))
    internals(ctx, 'internals-start')
    p.goto('https://before-you-pay-9b8c6.web.app/demo-store/index.html', wait_until='networkidle')
    summary['typeof'] = p.evaluate('typeof LanguageModel'); log('typeof LanguageModel', summary['typeof'])
    if summary['typeof'] != 'function': log('STOP: no LanguageModel'); 
    else:
        avail = p.evaluate("Promise.race([LanguageModel.availability(), new Promise(r=>setTimeout(()=>r('timeout'),30000))])")
        summary['availability_first'] = avail; log('availability first:', avail)
        if avail in ('downloadable', 'downloading'):
            p.evaluate("""() => { const b = document.createElement('button'); b.id='nanoDl'; b.textContent='download nano'; b.style='position:fixed;top:0;left:0;z-index:99999;padding:20px';
              b.onclick = () => { window.__dl = []; LanguageModel.create({monitor(m){m.addEventListener('downloadprogress', e => window.__dl.push(e.loaded))}})
                .then(s => { window.__created = 'ok'; s.destroy(); }).catch(e => { window.__created = 'error: ' + e.name + ': ' + e.message; }); };
              document.body.append(b); }""")
            p.click('#nanoDl')
            t0 = time.time()
            while time.time() - t0 < 3600:
                st = p.evaluate("({c: window.__created, d: (window.__dl||[]).slice(-1)[0], n: (window.__dl||[]).length})")
                if int(time.time() - t0) % 60 < 15: log('download', round(time.time() - t0), 's', st)
                if st['c']: break
                time.sleep(15)
            summary['create'] = p.evaluate('window.__created'); summary['download_s'] = round(time.time() - t0)
            log('create result', summary['create'])
        avail2 = p.evaluate("Promise.race([LanguageModel.availability(), new Promise(r=>setTimeout(()=>r('timeout'),30000))])")
        summary['availability_after'] = avail2; log('availability after:', avail2)
        internals(ctx, 'internals-after')
        if avail2 == 'available':
            # Raw sanity prompt, timed
            r = p.evaluate("""async () => { const t0 = performance.now(); const s = await LanguageModel.create(); const t1 = performance.now();
                const out = await s.prompt('Reply with one word: what color is the sky on a clear day?'); const t2 = performance.now(); s.destroy();
                return {create_ms: t1 - t0, prompt_ms: t2 - t1, out}; }""")
            summary['sanity'] = r; log('sanity', r)
            # The real app path: hosted panel, demo store, Check this page
            pp = ctx.new_page(); pp.on('console', lambda m: log('panel console:', m.text[:300]))
            
            pp.bring_to_front(); pp.goto('https://before-you-pay-9b8c6.web.app/panel.html?v2=' + str(int(time.time())), wait_until='load', timeout=90000); time.sleep(3)
            pp.click('#demo'); time.sleep(3)
            pp.screenshot(path=f'{W}/panel-1-basic.png', full_page=True)
            t0 = time.time(); pp.click('#check'); statuses = []
            while time.time() - t0 < 900:
                s = pp.eval_on_selector('#status', 'e => e.innerText')
                if not statuses or statuses[-1][1] != s: statuses.append((round(time.time() - t0, 2), s)); log('status', round(time.time() - t0, 2), s)
                if pp.evaluate("document.querySelectorAll('.badge.on_device').length") > 0 and not pp.evaluate("document.getElementById('stop').hidden === false"): break
                if not pp.evaluate("document.getElementById('consent').hidden"): log('consent box shown: on-device path not taken'); break
                time.sleep(0.5)
            summary['panel_wall_s'] = round(time.time() - t0, 2); summary['panel_status_timeline'] = statuses
            time.sleep(2)
            summary['panel_cards'] = pp.eval_on_selector_all('.card', 'els => els.map(e => e.innerText.replace(/\\s+/g, " "))')
            summary['on_device_badges'] = pp.evaluate("document.querySelectorAll('.badge.on_device').length")
            for sel in ['#summary', '#costToday', '#costTotal', '#costGap', '#dlDate', '#dlText', '#demoNote', '#route']:
                summary['panel' + sel] = pp.eval_on_selector(sel, 'e => e.innerText')
            pp.screenshot(path=f'{W}/panel-2-on-device.png', full_page=True)
            summary['raw_nano'] = pp.evaluate('globalThis.bypDeviceLog || null')
            summary['cost_lines'] = pp.eval_on_selector_all('#costLines li', 'els => els.map(e => e.innerText.replace(/\\s+/g, " "))')
            # Terms page is the cloud half (App Check may refuse this browser; then the panel shows the saved real cloud answer and says so)
            pp.click('#readTerms')
            for _ in range(40):
                if not __import__('re').search('Fetching|reading', pp.eval_on_selector('#cancelOut', 'e => e.innerText'), 2): break
                time.sleep(1)
            time.sleep(2)
            summary['terms_out'] = pp.eval_on_selector('#cancelOut', 'e => e.innerText')[:600]
            for sel in ['#dlDate', '#dlText', '#costTotal', '#costGap']: summary['after_terms' + sel] = pp.eval_on_selector(sel, 'e => e.innerText')
            pp.screenshot(path=f'{W}/panel-3-with-terms.png', full_page=True)
            # Second on-device read, same page, for a warm latency sample
            t1 = time.time(); before = pp.eval_on_selector('#status', 'e => e.innerText'); pp.click('#check')
            while time.time() - t1 < 600:
                st = pp.eval_on_selector('#status', 'e => e.innerText')
                if st != before and 'Read on this computer' in st: break
                time.sleep(0.5)
            summary['second_read_wall_s'] = round(time.time() - t1, 2); summary['second_read_status'] = pp.eval_on_selector('#status', 'e => e.innerText')
            summary['second_read_total'] = pp.eval_on_selector('#costTotal', 'e => e.innerText')
            log('second read', summary['second_read_wall_s'], summary['second_read_status'])
    log('SUMMARY', json.dumps(summary, indent=1))
    json.dump(summary, open(f'{W}/summary.json', 'w'), indent=1)
    time.sleep(3)
rec.stdin.write(b'q'); rec.stdin.flush(); rec.wait(timeout=30)
chrome.terminate(); xvfb.terminate()
sh(f'ls -la {W}; rm -rf {PROF} 2>/dev/null; true')
