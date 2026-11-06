// ==UserScript==
// @name         AI 生图参考图一键填充
// @namespace    https://github.com/yjiace/ai-ref-autofill
// @supportURL   https://github.com/yjiace/ai-ref-autofill/issues
// @version      0.0.5
// @license      MIT
// @description  在 Gemini / ChatGPT / Grok / 豆包 / 通义 等生图聊天页内浏览中文 AI 脸库、服装库、姿势库（含多角度与深度图 Depth），选择后自动把高清参考图和提示词填入对话框，由你自己点击生成
// @match        https://gemini.google.com/*
// @match        https://aistudio.google.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://grok.com/*
// @match        https://x.com/i/grok*
// @match        https://www.doubao.com/*
// @match        https://chat.qwen.ai/*
// @match        https://www.qianwen.com/*
// @match        https://tongyi.aliyun.com/*
// @match        https://yuanbao.tencent.com/*
// @match        https://copilot.microsoft.com/*
// @match        https://copilot.com/*
// @match        https://www.copilot.com/*
// @match        https://*.copilot.microsoft.com/*
// @match        https://www.bing.com/chat*
// @match        https://www.bing.com/copilot*
// @match        https://*.bing.com/chat*
// @match        https://*.bing.com/copilot*
// @match        https://www.kimi.com/*
// @match        https://poe.com/*
// @match        https://jimeng.jianying.com/*
// @match        https://lmarena.ai/*
// @match        https://arena.ai/*
// @match        https://*.arena.ai/*
// @match        https://chat.lmsys.org/*
// @noframes
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      ai-pose-gallery.smallyoung.cn
// @connect      ai-pose-gallery.anhao.app
// @connect      charadb-2fi.pages.dev
// @connect      ai-costume-anime-gallery.pages.dev
// @connect      cdn.jsdelivr.net
// @connect      fastly.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      *
// ==/UserScript==

/*
 * 数据与图片来自 anhao/ai-pose-gallery-zh（原作者 ギア @giaaibusi；中国历代服饰 Shisei；二次元服装 たき AI @taki_auto · CharaDB）。
 * 脚本只在运行时从公开/私有地址读取，不打包、不再分发图片。
 * 姿势库 / 服装库图片禁止再分发，脸库与中国历代服饰为 CC0；使用请遵守原仓库的免责声明。
 * 想在其他站点使用：在上面追加 @match 即可。
 */
(() => {
    'use strict';
    if (window.top !== window.self) return;

    /* ───────────── 配置 ───────────── */
    const CONFIG = {
        // 依次尝试，第一个能读到数据的作为图片根地址
        sources: [
            'https://ai-pose-gallery.smallyoung.cn/',
            'https://ai-pose-gallery.anhao.app/',
            'https://cdn.jsdelivr.net/gh/anhao/ai-pose-gallery-zh@main/',
            'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/',
        ],
        // 远程配置清单地址（存在时自动接管文件列表、内容哈希、分类标签与字段映射，实现零代码改动的动态热更新）
        manifest: 'data/manifest.json',
        files: {
            pose: 'data/pose-zh.json',
            costume: [
                'data/costume-zh.json',
                'data/costume-shisei-zh.json',
                'data/costume-anime-zh.json',
                'data/costume-gia-anime-zh.json',
            ],
            face: 'data/portrait-zh.json'
        },
        sourceLabels: {
            gia: '现实穿搭',
            shisei: '中国历代',
            charadb: '二次元·CharaDB',
            'gia-anime': '二次元·ギア',
        },
        // 字段名自动识别不准时在这里覆盖，例如：
        // costume: { id: '编号', title: '服装名称', cat: '分类', thumb: '缩略图', full: '原图', desc: '标签', en: '英文Prompt' }
        mapping: { pose: {}, costume: {}, face: {} },
        cacheHours: 24,
    };

    const LIBS = [['face', '脸'], ['costume', '服装'], ['pose', '姿势']];
    const LABELS = { face: ['发长', '发型'], costume: ['大类', '分类'], pose: ['体系', '动作分类'] };
    const NSFW = /性感|缠绵|内衣|睡衣|泳装|魅力写真|双人互动|贴身穿搭|魅力穿搭/;
    const STYLES = [
        ['不指定（跟随参考图）', ''],
        ['写实人像写真', '写实人像摄影，自然光线，真实皮肤质感'],
        ['日系二次元插画', '日系二次元插画风格，干净线条，柔和上色'],
        ['2.5D 游戏立绘', '2.5D 游戏角色立绘，精致渲染'],
        ['电影感剧照', '电影感剧照，浅景深，电影级打光'],
        ['赛博朋克霓虹', '赛博朋克风格，霓虹灯光，夜景'],
        ['角色设定图（白底）', '角色设定图，纯白背景，全身展示'],
    ];
    const DEF = { method: 'auto', order: 'imgFirst', maxImages: '', append: true, autoSend: false, safe: true, convert: 'jpeg', style: '', dockPos: 'auto' };
    const settings = Object.assign({}, DEF, GM_getValue('settings', {}));
    const saveSettings = () => GM_setValue('settings', settings);
    // 站点对参考图数量的限制（0 = 不限）。可按站点配置
    const SITE_LIMIT = []; // 如需按站点限制，可加 [/域名正则/, 数量]
    const siteLimit = () => { const x = SITE_LIMIT.find(([re]) => re.test(location.host)); return x ? x[1] : 0; };
    const getLimit = () => { const v = parseInt(settings.maxImages, 10); return String(settings.maxImages) !== '' && v >= 0 ? v : siteLimit(); };

    /* ───────────── 工具 ───────────── */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const IMG_RE = /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i;
    const isAbs = (s) => /^https?:/i.test(s);

    function gm(url, type = 'text') {
        return new Promise((res, rej) =>
            GM_xmlhttpRequest({
                url, method: 'GET', responseType: type === 'blob' ? 'blob' : 'text', timeout: 30000,
                onload: (r) => (r.status >= 200 && r.status < 300 ? res(r.response) : rej(new Error('HTTP ' + r.status))),
                onerror: () => rej(new Error('网络错误')), ontimeout: () => rej(new Error('超时')),
            })
        );
    }

    /* ───────────── 数据 ───────────── */
    const state = {
        tab: 'face', raw: {}, items: {}, sel: {}, q: '', f1: '', f2: '',
        list: [], shown: 0, bases: CONFIG.sources.slice(), dirty: false, busy: false,
        poseDepth: false, dragging: false, resizing: false, fabDragging: false,
        manifestLoaded: false, manifestHashes: {},
        sourceLabels: Object.assign({}, CONFIG.sourceLabels),
        nsfwRe: NSFW,
    };

    function toArray(j) {
        if (Array.isArray(j)) return j;
        let best = [];
        const walk = (o, d) => {
            if (!o || typeof o !== 'object' || d > 2) return;
            for (const v of Object.values(o)) {
                if (Array.isArray(v)) { if (v.length > best.length && typeof v[0] === 'object') best = v; }
                else walk(v, d + 1);
            }
        };
        walk(j, 0);
        return best;
    }

    async function ensureManifest() {
        if (state.manifestLoaded) return;
        state.manifestLoaded = true;
        if (!CONFIG.manifest) return;
        for (const base of CONFIG.sources) {
            try {
                const m = JSON.parse(await gm(base + CONFIG.manifest));
                if (!m || typeof m !== 'object' || !m.libraries) continue;
                state.bases = [base, ...CONFIG.sources.filter((b) => b !== base)];
                if (m.sourceLabels && typeof m.sourceLabels === 'object') {
                    Object.assign(state.sourceLabels, m.sourceLabels);
                }
                if (m.mapping && typeof m.mapping === 'object') {
                    for (const [k, v] of Object.entries(m.mapping)) {
                        if (v && typeof v === 'object') Object.assign((CONFIG.mapping[k] = CONFIG.mapping[k] || {}), v);
                    }
                }
                if (m.nsfwPattern && typeof m.nsfwPattern === 'string') {
                    try { state.nsfwRe = new RegExp(m.nsfwPattern); } catch (_) { }
                }
                for (const [lib, def] of Object.entries(m.libraries)) {
                    if (!def || typeof def !== 'object') continue;
                    if (Array.isArray(def.files) && def.files.length) CONFIG.files[lib] = def.files;
                    if (Array.isArray(def.filters) && def.filters.length === 2) LABELS[lib] = def.filters;
                    if (def.hash) state.manifestHashes[lib] = String(def.hash);
                }
                return;
            } catch (_) { /* 当前源无 manifest 或网络异常则尝试下一源，最终回退内置 CONFIG */ }
        }
    }

    async function loadRaw(lib) {
        await ensureManifest();
        const key = 'cache_v4_' + lib;
        const remoteHash = state.manifestHashes[lib] || '';
        const c = GM_getValue(key, null);
        if (c && c.d && c.d.length) {
            if (remoteHash ? c.h === remoteHash : (Date.now() - c.t < CONFIG.cacheHours * 3600e3)) {
                return c.d;
            }
        }
        const rawFiles = Array.isArray(CONFIG.files[lib]) ? CONFIG.files[lib] : [CONFIG.files[lib]];
        const fileDefs = rawFiles.map((f) => (typeof f === 'string' ? { path: f } : f)).filter((f) => f && f.path);
        let err;
        for (const base of state.bases) {
            try {
                const results = await Promise.all(
                    fileDefs.map(async (f) => {
                        const list = toArray(JSON.parse(await gm(base + f.path)));
                        if (f.cat2 || f.source) {
                            list.forEach((item) => {
                                if (item && typeof item === 'object') {
                                    if (f.cat2 && !item._cat2) item._cat2 = f.cat2;
                                    if (f.source && !item.source) item.source = f.source;
                                }
                            });
                        }
                        return list;
                    })
                );
                const arr = results.flat();
                if (!arr.length) throw new Error('数据为空');
                state.bases = [base, ...CONFIG.sources.filter((b) => b !== base)];
                try { GM_setValue(key, { t: Date.now(), h: remoteHash, d: arr }); } catch (_) { /* 超出存储配额则不缓存 */ }
                return arr;
            } catch (e) { err = e; }
        }
        throw err || new Error('加载失败');
    }

    // 字段读取：先看手动映射，再按正则匹配键名
    function reader(lib) {
        const m = CONFIG.mapping[lib] || {};
        return (r, name, res) => {
            if (m[name] && r[m[name]] != null) return String(r[m[name]]);
            for (const re of res) {
                for (const k of Object.keys(r)) {
                    const v = r[k];
                    if (re.test(k) && v != null && v !== '' && typeof v !== 'object') return String(v);
                }
            }
            return '';
        };
    }
    function fixPath(v, kind, dir) {
        if (!v || isAbs(v) || v.includes('/')) return v;
        return (kind === 'thumb' ? 'thumbs/' : 'img/') + (dir ? dir + '/' : '') + v;
    }
    function allText(r) {
        return Object.values(r).filter((v) => typeof v === 'string' || typeof v === 'number').join(' ').toLowerCase();
    }

    function normPose(recs) {
        const rd = reader('pose');
        const groups = new Map();
        recs.forEach((r, i) => {
            const sys = rd(r, 'sys', [/体系|系統/]);
            const no = rd(r, 'no', [/姿势编号|ポーズ番号/]);
            const key = sys + '|' + (no || r.id || i);
            let it = groups.get(key);
            if (!it) {
                const subCat = rd(r, 'cat', [/^分类$|分類/]);
                it = { lib: 'pose', id: key, title: rd(r, 'title', [/姿势名称|ポーズ名/]) || no || key, cat: sys, cat2: subCat, angles: [], cur: 0, nsfw: Boolean(r.敏感) || state.nsfwRe.test(sys + ' ' + subCat), s: '' };
                groups.set(key, it);
            }
            if (r.敏感) it.nsfw = true;
            it.angles.push({
                angle: rd(r, 'angle', [/角度|アングル/]),
                thumb: fixPath(rd(r, 'thumb', [/缩略|サムネ|thumb/i]), 'thumb'),
                full: fixPath(rd(r, 'full', [/^原图$|原寸|full/i]), 'full'),
                id: r.id || '',
            });
            it.s += ' ' + allText(r);
        });
        const out = [...groups.values()];
        out.forEach((it) => { const f = it.angles.findIndex((a) => /正面/.test(a.angle)); it.cur = f > -1 ? f : 0; it.search = it.s; });
        return out;
    }

    function normGeneric(lib, recs) {
        const rd = reader(lib);
        const dir = lib === 'face' ? 'portrait' : 'costume';
        return recs.map((r, i) => {
            let thumb = rd(r, 'thumb', [/缩略|サムネ|thumb/i]);
            let full = rd(r, 'full', [/^原图$|原寸|原图|full|origin/i]);
            if (!thumb || !full) {
                const imgs = Object.values(r).filter((v) => typeof v === 'string' && IMG_RE.test(v));
                thumb = thumb || imgs.find((v) => /thumb/i.test(v)) || imgs[0] || '';
                full = full || imgs.find((v) => v !== thumb) || imgs[0] || '';
            }
            const id = rd(r, 'id', [/^id$/i, /图片ID|编号/i]) || lib + '-' + i;
            const isFace = lib === 'face';
            const rawTags = r['标签'] ?? r.tags;
            const hair = isFace ? rd(r, 'hair', [/细分发型|发型名称|发型/]) : '';
            const cat = isFace
                ? rd(r, 'cat', [/发长/])
                : (r['大类'] || r._cat2 || (r.source && state.sourceLabels[r.source]) || r['来源'] || (r['一级分类'] === '二次元' || isAbs(thumb) ? '二次元' : '现实穿搭'));
            const rawSubCat = isFace
                ? hair
                : rd(r, 'cat2', [/^分类$/, /^类别$/, /^子分类$/, /穿搭|季节|分类/]);
            const cat2 = (!isFace && (!rawSubCat || rawSubCat === cat) && Array.isArray(rawTags) && rawTags[0])
                ? String(rawTags[0])
                : rawSubCat;
            const title = rd(r, 'title', isFace ? [/标题|细分发型|发型/] : [/中文.*(名|描述)|名称|款式|单品|name|title/i]) || id;
            const desc = Array.isArray(rawTags)
                ? rawTags.filter(Boolean).join('、')
                : rd(r, 'desc', [/标签|tags/i]);
            const en = rd(r, 'en', [/英文|prompt|english|关键词/i]);
            const hasViews = Array.isArray(r.views) && r.views.length > 0;
            const angles = hasViews
                ? r.views.map((v) => ({
                    angle: v.label || v.id || '',
                    thumb: fixPath(v['缩略图'] || v.thumb || '', 'thumb', dir),
                    full: fixPath(v['原图'] || v['预览图'] || v.full || '', 'full', dir),
                    id: id + '_' + (v.id || v.label || ''),
                }))
                : null;
            const defIdx = hasViews && r.selectedView
                ? Math.max(0, r.views.findIndex((v) => v.id === r.selectedView))
                : 0;
            const item = {
                lib, id, title, cat, cat2, hair, desc, en,
                thumb: fixPath(thumb, 'thumb', dir), full: fixPath(full, 'full', dir),
                nsfw: Boolean(r.敏感) || state.nsfwRe.test(cat + ' ' + cat2),
                search: [rd(r, 'search', [/^检索$|search/i]) || allText(r), desc, cat, cat2].filter(Boolean).join(' ').toLowerCase(),
            };
            if (angles) {
                item.angles = angles;
                item.cur = defIdx;
            }
            return item;
        });
    }

    async function ensureLib(lib) {
        if (state.items[lib]) return;
        state.raw[lib] = await loadRaw(lib);
        state.items[lib] = lib === 'pose' ? normPose(state.raw[lib]) : normGeneric(lib, state.raw[lib]);
    }

    /* ───────────── 图片获取 ───────────── */
    function posePath(raw, kind, isDepth) {
        if (!raw || !isDepth) return raw;
        const clean = String(raw).replace(/^\/+/, '');
        if (kind === 'thumb') {
            if (clean.startsWith('thumbs/depth/')) return raw;
            if (clean.startsWith('thumbs/')) {
                return `thumbs/depth/${clean.slice('thumbs/'.length).replace(/\.(jpe?g|png)$/i, '.webp')}`;
            }
        } else {
            if (clean.startsWith('img/depth/')) return raw;
            if (clean.startsWith('img/')) {
                return `img/depth/${clean.slice('img/'.length).replace(/\.(png|jpe?g)$/i, '.webp')}`;
            }
        }
        return raw;
    }

    const thumbOf = (it, isDepth) => {
        if (it.lib === 'pose' && it.angles && it.angles.length) {
            const raw = it.angles[it.cur]?.thumb || '';
            return posePath(raw, 'thumb', isDepth ?? state.poseDepth);
        }
        return it.angles ? it.angles[it.cur]?.thumb : it.thumb;
    };

    const fullOf = (it, ai, isDepth) => {
        if (it.lib === 'pose' && it.angles && it.angles.length) {
            const raw = it.angles[ai ?? it.cur]?.full || '';
            return posePath(raw, 'full', isDepth ?? (state.sel['pose']?.isDepth || state.poseDepth));
        }
        return it.angles ? it.angles[ai ?? it.cur]?.full : it.full;
    };

    const mimeOf = (p) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }[(p.split('?')[0].split('.').pop() || '').toLowerCase()] || 'image/jpeg');
    const retype = (b, rel) => (b.type && b.type.startsWith('image/') ? b : new Blob([b], { type: mimeOf(rel) }));

    async function fetchBlob(rel) {
        const urls = isAbs(rel) ? [rel] : state.bases.map((b) => b + rel);
        let err;
        for (const u of urls) { try { return retype(await gm(u, 'blob'), rel); } catch (e) { err = e; } }
        throw err;
    }

    let running = 0; const waiting = [];
    const slot = () => new Promise((r) => { const go = () => { running++; r(); }; running < 6 ? go() : waiting.push(go); });
    const release = () => { running--; const n = waiting.shift(); if (n) n(); };
    const tcache = new Map(), tblob = new Map();
    function thumbURL(rel) {
        if (!tcache.has(rel)) {
            tcache.set(rel, (async () => {
                await slot();
                try { const b = await fetchBlob(rel); tblob.set(rel, b); return URL.createObjectURL(b); }
                catch (e) { tcache.delete(rel); throw e; }
                finally { release(); }
            })());
        }
        return tcache.get(rel);
    }
    const toDataURL = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    function setThumb(img, rel) {
        if (!rel) return;
        thumbURL(rel).then((u) => {
            img.onerror = () => { if (!img._d && tblob.get(rel)) { img._d = 1; toDataURL(tblob.get(rel)).then((d) => (img.src = d)); } };
            img.src = u;
        }).catch(() => { img.alt = '加载失败'; });
    }

    async function convertBlob(b) {
        if (settings.convert === 'none' || !/webp|avif|gif/.test(b.type)) return b;
        const bmp = await createImageBitmap(b);
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        const ctx = cv.getContext('2d');
        const type = settings.convert === 'png' ? 'image/png' : 'image/jpeg';
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
        ctx.drawImage(bmp, 0, 0);
        return await new Promise((r) => cv.toBlob((x) => r(x || b), type, 0.93));
    }

    async function buildFiles() {
        const files = [];
        for (const [lib] of LIBS) {
            const s = state.sel[lib];
            if (!s) continue;
            let blob;
            let ext;
            let id;
            if (s.isCustom && s.file) {
                blob = await convertBlob(s.file);
                ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                id = 'custom_' + Date.now();
            } else {
                // 填充时严格提取高清原图，仅在原图字段缺失时才降级为缩略图
                const rel = (lib === 'pose' ? fullOf(s.item, s.ai, s.isDepth) : fullOf(s.item, s.ai)) ||
                    (lib === 'pose' ? thumbOf(s.item, s.isDepth) : thumbOf(s.item));
                if (!rel) throw new Error(lib + ' 缺少图片地址，请检查字段映射');
                blob = await convertBlob(await fetchBlob(rel));
                ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                id = String(s.item.angles ? s.item.angles[s.ai].id || s.item.id : s.item.id).replace(/[^\w\-]+/g, '_');
            }
            const depthTag = (lib === 'pose' && s.isDepth) ? '_depth' : '';
            files.push(new File([blob], lib + '-' + id + depthTag + '.' + ext, { type: blob.type }));
        }
        return files;
    }

    /* ───────────── 提示词 ───────────── */
    function buildPrompt() {
        const { face, costume, pose } = state.sel;
        const lines = []; let n = 0;
        if (face) {
            n++;
            if (face.isCustom) {
                lines.push('图' + n + '（人像参考）：保持该人物的脸型与五官。');
            } else {
                const h = [face.item.cat, face.item.hair && face.item.hair !== face.item.cat ? face.item.hair : ''].filter(Boolean).join('·');
                lines.push('图' + n + '（人像参考）：保持该人物的脸型与五官' + (h ? '，发型参考：' + h : '') + '。');
            }
        }
        if (costume) {
            n++;
            if (costume.isCustom) {
                lines.push('图' + n + '（服装参考）：让人物穿上图中这套服装，保留款式、颜色与细节。');
            } else {
                const c = costume.item;
                const d = [c.title, c.desc].filter(Boolean).join('，');
                const ca = c.angles && c.angles[costume.ai] ? c.angles[costume.ai].angle : '';
                const cAng = ca ? '（' + ca + '视角）' : '';
                lines.push('图' + n + '（服装参考）：让人物穿上图中这套服装' + (d ? '（' + d + '）' : '') + cAng + '，保留款式、颜色与细节。' + (c.en ? '\nKeywords: ' + c.en : ''));
            }
        }
        if (pose) {
            n++;
            if (pose.isCustom) {
                lines.push('图' + n + '（姿势参考）：人物采用该图中的姿势与构图动作。');
            } else {
                const p = pose.item;
                const a = p.angles && p.angles[pose.ai] ? p.angles[pose.ai].angle : '';
                const ang = a ? '（' + a + '视角）' : '';
                if (pose.isDepth) {
                    lines.push('图' + n + '（ControlNet 深度图参考）：严格按照该深度图（Depth Map）的空间景深结构、前后距离与四肢立体动态构图生图' + ang + '。');
                } else {
                    lines.push('图' + n + '（姿势参考）：人物采用该姿势：' + p.title + ang + '。该图是无脸灰色人台线稿，只参考动作与构图，不要保留人台外观。');
                }
            }
        }
        const head = n ? '请参考我上传的 ' + n + ' 张图片，生成一张新图片：' : '请生成一张图片：';
        const extra = ui.extra.value.trim();
        const tail = [settings.style && '风格：' + settings.style, extra, n ? '画质高清，细节自然，手部结构正确。' : ''].filter(Boolean);
        return [head, ...lines, ...tail].join('\n');
    }
    function refreshPrompt() { if (!state.dirty) ui.ta.value = buildPrompt(); }

    /* ───────────── 站点适配 ───────────── */
    // input：输入框候选选择器（按优先级）；attach：参考图注入方式（按顺序尝试，前一种使预览增加即停止）
    const SITES = [
        { re: /chatgpt\.com|chat\.openai\.com/, input: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]'], attach: ['paste'] },
        { re: /gemini\.google\.com/, input: ['rich-textarea .ql-editor', 'div.ql-editor[contenteditable="true"]'], attach: ['paste'] },
        { re: /aistudio\.google\.com/, input: ['ms-autosize-textarea textarea', 'textarea[aria-label*="prompt" i]', 'textarea'], attach: ['paste'] },
        { re: /grok\.com/, input: ['div[contenteditable="true"]', 'textarea'], attach: ['paste'] },
        { re: /x\.com/, input: ['div[data-testid*="grok" i] div[contenteditable="true"]', 'div[data-testid*="grok" i] textarea', 'textarea'], attach: ['paste', 'drop'] },
        { re: /doubao\.com/, input: ['textarea[data-testid="chat_input_input"]', 'textarea'], attach: ['paste', 'drop', 'file'] },
        { re: /qwen\.ai|qianwen\.com|tongyi/, input: ['[data-slate-editor="true"]', 'textarea#chat-input', 'div[contenteditable="true"]', 'textarea'], attach: ['paste', 'drop', 'file'] },
        { re: /yuanbao\.tencent\.com/, input: ['[data-input-editor-area] .ql-editor', '.ql-editor[contenteditable="true"]'], attach: ['chooser', 'drop', 'paste'] },
        { re: /copilot\.(microsoft\.)?com|bing\.com\/(chat|copilot)/, input: ['textarea#userInput', 'textarea[placeholder]', 'div[role="textbox"]', 'textarea'], attach: ['paste', 'drop', 'file'] },
        { re: /kimi\.com/, input: ['div[data-testid*="chat-input"]', 'div[class*="chat-input-editor"]', 'div[contenteditable="true"]'], attach: ['paste'] },
        { re: /jimeng\.jianying\.com/, input: ['div.tiptap.ProseMirror[contenteditable="true"]', 'div[role="textbox"][aria-label*="提示词"]', 'div.ProseMirror', 'textarea'], attach: ['chooser', 'drop'], strict: true },
        { re: /poe\.com/, input: ['textarea[class*="GrowingTextArea" i]', 'textarea[class*="textInput" i]', 'textarea'], attach: ['file', 'paste', 'drop'] },
        { re: /arena\.ai|lmarena\.ai|chat\.lmsys\.org/, input: ['textarea[data-testid="textbox"]', 'textarea'], attach: ['paste', 'file'] },
    ];
    const FALLBACK_SITE = { input: [], attach: ['paste', 'drop', 'file'] };
    const currentSite = () => SITES.find((s) => s.re.test(location.host + location.pathname)) || FALLBACK_SITE;

    /* ───────────── DOM 查询 ───────────── */
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 80 && r.height > 16 && getComputedStyle(e).visibility !== 'hidden'; };
    const NEGATIVE = /负向|不想出现|不希望出现|反向提示|negative/i;
    const isNegative = (e) => NEGATIVE.test((e.getAttribute('placeholder') || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.name || ''));

    // 穿透 open Shadow DOM 查询，并排除脚本自身的面板，避免把内容写入自己的输入框
    function deepAll(sel, root = document) {
        const out = [...root.querySelectorAll(sel)];
        for (const n of root.querySelectorAll('*')) {
            if (n.shadowRoot && n !== host) out.push(...deepAll(sel, n.shadowRoot));
        }
        return out;
    }

    function findInput() {
        const usable = (e) => visible(e) && !isNegative(e);
        for (const s of currentSite().input) {
            const e = deepAll(s).filter(usable).pop();
            if (e) return e;
        }
        let best = null, bs = -1;
        for (const e of deepAll('textarea,[contenteditable="true"],[contenteditable=""],[role="textbox"]').filter(usable)) {
            let sc = e.getBoundingClientRect().bottom / innerHeight;
            if (document.activeElement === e) sc += 2;
            if (/message|prompt|ask|chat|输入|发消息|问|描述|说点/i.test((e.getAttribute('placeholder') || '') + (e.getAttribute('aria-label') || '') + (e.getAttribute('data-placeholder') || ''))) sc += 1;
            if (sc > bs) { bs = sc; best = e; }
        }
        return best;
    }

    const composerOf = (el) =>
        el.closest('form,[data-new-input-card],[data-testid*="generator" i],[aria-label="生成"],[class*="generator" i],[class*="main-frame" i]') ||
        el.closest('[class*="composer" i]') || el.closest('[class*="input" i]') || el.parentElement || el;

    /* ───────────── 文字写入 ───────────── */
    // Slate（千问等）：必须先让它的内部选区与 DOM 选区同步，再输入；成功标志是占位符消失
    async function setTextSlate(ed, text, append) {
        const probe = text.slice(0, 8);
        const hasText = () => !!ed.querySelector('[data-slate-string]');
        const placed = () => !ed.querySelector('[data-slate-placeholder]') && ed.textContent.includes(probe);
        const placeCaret = () => {
            ed.focus();
            const leaves = ed.querySelectorAll('[data-slate-string],[data-slate-zero-width]');
            const last = leaves[leaves.length - 1];
            const tn = last && last.firstChild;
            if (!tn) return;
            const r = document.createRange();
            const off = last.hasAttribute('data-slate-zero-width') ? 0 : tn.length;
            r.setStart(tn, off); r.collapse(true);
            const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        };
        const prepare = async () => {
            ed.focus(); await sleep(150);
            if (hasText() && !append) document.execCommand('selectAll'); else placeCaret();
            await sleep(300); // 等 Slate 处理 selectionchange
        };
        const typeLines = async (t) => {
            const lines = t.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) { document.execCommand('insertLineBreak'); await sleep(15); }
                if (lines[i]) { document.execCommand('insertText', false, lines[i]); await sleep(15); }
            }
        };
        const strategies = [
            async () => { if (append && hasText()) { document.execCommand('insertLineBreak'); await sleep(15); } await typeLines(text); },
            async () => {
                const dt = new DataTransfer(); dt.setData('text/plain', text);
                ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
            },
            async () => {
                const dt = new DataTransfer(); dt.setData('text/plain', text);
                ed.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt }));
            },
        ];
        for (const run of strategies) {
            await prepare();
            await run();
            await sleep(250);
            if (placed()) return;
        }
        throw new Error('千问输入框未接受文字，请复制面板里的提示词手动粘贴');
    }

    // 原生 textarea / input：先走浏览器编辑管线，再用原型 setter 与完整事件序列同步框架内部状态
    async function setNativeText(el, text, append) {
        const full = append && el.value.trim() ? el.value + '\n' + text : text;
        el.focus();
        el.select();
        document.execCommand('insertText', false, full);
        if (el.value !== full) {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, full);
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: full }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        await sleep(80);
        if (!el.value.includes(text.slice(0, 8))) throw new Error('输入框不接受自动填文字，请复制面板里的提示词手动粘贴');
    }

    // contenteditable（Quill / ProseMirror / Lexical 等）：依次尝试 beforeinput、paste、execCommand
    async function setRichText(el, text, append) {
        if (!el.isContentEditable) { const inner = el.querySelector('[contenteditable="true"]'); if (inner) el = inner; }
        el.focus();
        document.execCommand('selectAll');
        if (append) getSelection().collapseToEnd();
        const full = (append && el.textContent.trim() ? '\n' : '') + text;
        const probe = text.slice(0, 8);
        const ok = () => el.textContent.includes(probe);
        const dt = new DataTransfer(); dt.setData('text/plain', full);

        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt }));
        await sleep(80);
        if (!ok()) { el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); await sleep(80); }
        if (!ok()) {
            const lines = full.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) { document.execCommand('insertLineBreak'); await sleep(15); }
                if (lines[i]) { document.execCommand('insertText', false, lines[i]); await sleep(15); }
            }
            await sleep(80);
        }
        if (!ok()) throw new Error('输入框不接受自动填文字，请复制面板里的提示词手动粘贴');
    }

    function setText(el, text, append) {
        const slate = el.closest && el.closest('[data-slate-editor]');
        if (slate) return setTextSlate(slate, text, append);
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return setNativeText(el, text, append);
        return setRichText(el, text, append);
    }

    /* ───────────── 附件注入 ───────────── */
    const makeDT = (files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); return dt; };

    // 取得页面脚本触发的文件选择框：拦截页面对 input[type=file].click() 的调用（不弹出系统对话框），
    // 同时监听 DOM 中新出现的 input[type=file]
    const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    async function captureFileInput(trigger) {
        const protos = [pageWin.HTMLInputElement?.prototype, window.HTMLInputElement?.prototype].filter(Boolean);
        const origClicks = protos.map((p) => p.click);
        let captured = null;
        const known = new Set(deepAll('input[type="file"]'));
        protos.forEach((p) => {
            p.click = function () {
                if (!this.type || this.type === 'file') { captured = this; return; }
                const orig = origClicks[protos.indexOf(p)];
                return orig ? orig.apply(this, arguments) : undefined;
            };
        });
        try {
            trigger();
            for (let i = 0; i < 20 && !captured; i++) {
                await sleep(100);
                captured = deepAll('input[type="file"]').find((n) => !known.has(n)) || null;
            }
        } finally {
            protos.forEach((p, idx) => { if (origClicks[idx]) p.click = origClicks[idx]; });
        }
        return captured;
    }

    async function fillFileInput(inp, files) {
        // 不支持多选的文件框一次只接收一个文件，逐个写入
        const batches = inp.multiple ? [files] : files.map((f) => [f]);
        for (const b of batches) {
            inp.files = makeDT(b).files;
            inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            await sleep(400);
        }
    }

    function clickEl(n) {
        if (!n) return;
        try { n.focus && n.focus(); } catch (_) { }
        const opts = { bubbles: true, cancelable: true, composed: true };
        n.dispatchEvent(new PointerEvent('pointerdown', opts));
        n.dispatchEvent(new MouseEvent('mousedown', opts));
        n.dispatchEvent(new PointerEvent('pointerup', opts));
        n.dispatchEvent(new MouseEvent('mouseup', opts));
        if (typeof n.click === 'function') {
            try { n.click(); } catch (_) { n.dispatchEvent(new MouseEvent('click', opts)); }
        } else {
            n.dispatchEvent(new MouseEvent('click', opts));
        }
    }

    const UPLOAD_LABEL = /添加图片|上传参考|上传|附件|attach|upload|reference-upload/i;
    const isUploadBtn = (b) => {
        const al = b.getAttribute('aria-label') || '';
        const cls = typeof b.className === 'string' ? b.className : '';
        const tid = b.getAttribute('data-testid') || '';
        const title = b.getAttribute('title') || '';
        return UPLOAD_LABEL.test(al) || UPLOAD_LABEL.test(cls) || UPLOAD_LABEL.test(tid) || UPLOAD_LABEL.test(title);
    };

    // 每种方式只向单一目标派发一次；返回 'skip' 表示当前页面不可用
    const METHODS = {
        async paste(el, files) {
            el.focus();
            // noBubble：仅触发编辑器自身的 paste 监听，避免祖先/文档级监听重复处理同一批文件
            const bubbles = !currentSite().noBubble;
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles, cancelable: true, clipboardData: makeDT(files) }));
        },
        async drop(el, files) {
            const target = composerOf(el);
            const dt = makeDT(files);
            for (const n of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(n, { bubbles: true, cancelable: true, dataTransfer: dt }));
        },
        async file(el, files) {
            const accepts = (i) => !i.accept || /image|\*|png|jpe?g|webp/i.test(i.accept);
            // 自输入框向外逐层查找，取离输入框最近、且接受图片的文件框（避免误用页面上其他功能的上传控件）
            let inp = null;
            for (let n = el; n && n !== document.documentElement && !inp; n = n.parentElement) {
                inp = deepAll('input[type="file"]', n).find(accepts) || null;
            }
            inp = inp || deepAll('input[type="file"]').find(accepts);
            if (!inp) return 'skip';
            await fillFileInput(inp, files);
        },
        // 点击输入卡片内的上传按钮（必要时先打开“添加”菜单），接管弹出的文件选择框
        async chooser(el, files) {
            const card = composerOf(el);
            const inCard = [...card.querySelectorAll('button,[role="button"],label')];
            let direct = inCard.find(isUploadBtn);
            if (!direct) {
                // 若卡片范围内未定位到，扩大至全局可见的上传按钮检索
                direct = deepAll('button,[role="button"],label').filter(visible).find(isUploadBtn);
            }
            let inp = null;
            if (direct) inp = await captureFileInput(() => clickEl(direct));
            if (!inp) {
                const candidates = inCard.length ? inCard : deepAll('button,[role="button"],label').filter(visible);
                const menuBtn = candidates.find((b) => /^(添加|更多|add)$/i.test(b.getAttribute('aria-label') || b.textContent || ''));
                if (menuBtn) {
                    clickEl(menuBtn);
                    await sleep(300);
                    const item = deepAll('[role="menuitem"],[role="option"],li,button,div,span')
                        .filter((n) => visible(n) || n.getBoundingClientRect().width > 0)
                        .filter((n) => n.children.length <= 3 && /^.{0,12}$/.test((n.textContent || '').trim()) && /图片|上传|文件/.test(n.textContent))
                        .pop();
                    if (item) inp = await captureFileInput(() => clickEl(item));
                }
            }
            if (!inp) return 'skip';
            await fillFileInput(inp, files);
        },
    };

    // 以页面内媒体元素数量是否增加判断附件预览是否出现
    const mediaCount = () => deepAll('img,canvas,video').length;
    async function waitGrow(before, ms) {
        for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (mediaCount() > before) return true;
        return false;
    }

    // 部分编辑器（即梦的 ProseMirror）会把同一次粘贴处理两遍，生成两组相同的参考图标签。
    // 仅当新增标签数恰为提交文件数的 2 倍且前后两半内容一致时，删除后一半。
    const MENTION_TAG = '.node-reference-mention-tag';
    async function dedupeMentions(el, existing, expected) {
        const fresh = [...el.querySelectorAll(MENTION_TAG)].filter((n) => !existing.has(n));
        if (fresh.length !== expected * 2) return;
        const texts = fresh.map((n) => n.textContent.trim());
        if (!texts.slice(0, expected).every((t, i) => t === texts[expected + i])) return;
        const range = document.createRange();
        range.setStartBefore(fresh[expected]);
        range.setEndAfter(fresh[fresh.length - 1]);
        el.focus();
        const sel = getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('delete');
        await sleep(300);
        const left = [...el.querySelectorAll(MENTION_TAG)].filter((n) => !existing.has(n)).length;
        console.info('[ai-ref] 已移除重复参考图标签，剩余新增 ' + left + ' 个');
    }

    async function attachFiles(el, files) {
        const order = settings.method === 'auto' ? currentSite().attach : [settings.method];
        const existing = new Set(el.querySelectorAll(MENTION_TAG));
        for (const m of order) {
            const before = mediaCount();
            const inEditorBefore = el.querySelectorAll('img').length;
            const r = await METHODS[m](el, files);
            const grew = r === 'skip' ? false : await waitGrow(before, 4000);
            console.info('[ai-ref] 注入图片 ' + m + ': ' + (r === 'skip' ? '无可用控件' : grew ? '检测到预览' : '未检测到预览') + '（本次提交 ' + files.length + ' 张）');
            if (grew) {
                await sleep(1500);
                console.info('[ai-ref] 输入框内图片数 ' + inEditorBefore + ' → ' + el.querySelectorAll('img').length);
                if (currentSite().dedupe) await dedupeMentions(el, existing, files.length);
                return m;
            }
            // strict：已实际派发过的站点不再回退到其他方式，防止同一批文件被重复上传
            if (currentSite().strict && r !== 'skip') return null;
        }
        return null;
    }

    async function fillChat() {
        if (state.busy) return;
        const hasSel = Object.keys(state.sel).some((k) => state.sel[k]);
        if (!hasSel && !ui.ta.value.trim()) return msg('请先选择参考图');
        const lim = getLimit();
        if (lim && Object.keys(state.sel).length > lim) return msg('本站最多支持 ' + lim + ' 张参考图，请先取消多余的选择');
        state.busy = true; ui.go.disabled = true;
        try {
            const input = findInput();
            if (!input) throw new Error('没找到聊天输入框，请先点一下输入框再试');
            let how = null;
            const doText = async () => {
                const t = ui.ta.value;
                await setText(findInput() || input, t, settings.append);
                await sleep(350);
                const t2 = findInput() || input;
                if (!String(t2.value ?? t2.textContent).includes(t.slice(0, 8))) await setText(t2, t, false);
            };
            if (settings.order === 'textFirst') await doText();
            if (hasSel) {
                msg('正在下载参考图…');
                const files = await buildFiles();
                msg('正在添加图片…');
                how = await attachFiles(findInput() || input, files);
                await sleep(500); // 宿主框架可能在上传后重建输入框
            }
            if (settings.order !== 'textFirst') await doText();
            if (settings.autoSend) {
                await sleep(1200);
                const b = [...document.querySelectorAll('button[data-testid="send-button"],button[aria-label*="发送"],button[aria-label*="Send" i],button[type="submit"]')].find((x) => !x.disabled && visible(x));
                if (b) b.click();
            }
            if (hasSel && !how) { msg('文字已填入；图片未检测到，可换一种“注入方式”或手动粘贴'); return; }
            msg('已填充（图片方式：' + (how || '无') + '），检查后点击生成即可');
            await sleep(350);
            toggle(false);
        } catch (e) { msg('失败：' + e.message); console.error('[ai-ref]', e); }
        finally { state.busy = false; ui.go.disabled = false; }
    }

    /* ───────────── 界面 ───────────── */
    const host = document.createElement('div');
    host.id = 'ai-ref-filler-host';
    const root = host.attachShadow({ mode: 'open' });
    const CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.r{--bg:#f6f7f8;--bg2:#fff;--ink:#20252b;--mu:#6b7480;--ln:#d9dde2;--ac:#2f5d8a;--ff:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font:13px/1.4 var(--ff);color:var(--ink)}
@media (prefers-color-scheme:dark){.r{--bg:#1d2126;--bg2:#272c33;--ink:#e6e9ed;--mu:#97a0ab;--ln:#3a4048;--ac:#6fa3d6}}
.fab{position:fixed;z-index:2147483646;height:38px;padding:0 14px;border:0;border-radius:19px;background:var(--ac);color:#fff;font:600 13px var(--ff);cursor:default;box-shadow:0 2px 10px rgba(0,0,0,.3);user-select:none;-webkit-user-select:none;touch-action:none;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;width:max-content;flex-shrink:0;writing-mode:horizontal-tb}
.fab.grabbing{opacity:.9}
.fab.active{box-shadow:0 0 0 2px var(--bg), 0 0 0 4px var(--ac), 0 4px 16px rgba(0,0,0,.35)}
.btn-sub{border:1px solid var(--ln);background:var(--bg);color:var(--ink);padding:3px 10px;border-radius:4px;cursor:pointer;font:11px var(--ff);white-space:nowrap}
.btn-sub:hover{border-color:var(--ac);color:var(--ac)}
.panel{position:fixed;z-index:2147483647;width:440px;min-width:280px;max-width:calc(100vw - 16px);height:min(86vh,780px);min-height:360px;max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--ln);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.3);overflow:hidden}
.panel.dragging{user-select:none;-webkit-user-select:none}
header{display:flex;align-items:center;gap:4px;padding:8px 8px 0;border-bottom:1px solid var(--ln);cursor:default;user-select:none;-webkit-user-select:none;touch-action:none}
header.grabbing{cursor:default}
header button, header .tabs{cursor:default}
.rh{position:absolute;z-index:10;touch-action:none}
.rh-nw{left:0;top:0;width:12px;height:12px;cursor:nwse-resize}
.rh-n{left:12px;right:12px;top:0;height:6px;cursor:ns-resize}
.rh-w{left:0;top:12px;bottom:12px;width:6px;cursor:ew-resize}
.rh-e{right:0;top:12px;bottom:12px;width:6px;cursor:ew-resize}
.rh-s{left:12px;right:12px;bottom:0;height:6px;cursor:ns-resize}
.rh-se{right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize}
.rh-ne{right:0;top:0;width:12px;height:12px;cursor:nesw-resize}
.rh-sw{left:0;bottom:0;width:12px;height:12px;cursor:nesw-resize}
.tabs{display:flex;flex:1;gap:2px;min-width:0;overflow:hidden}
.tab{padding:7px 14px;border:0;background:none;color:var(--mu);font:600 13px var(--ff);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;flex-shrink:0}
.tab.on{color:var(--ink);border-color:var(--ac)}
.h-icon,.x{border:0;background:none;color:var(--mu);cursor:pointer;width:24px;height:24px;padding:0;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.h-icon:hover,.x:hover{color:var(--ink);background:var(--bg2)}
.h-icon svg,.x svg{display:block;pointer-events:none}
.bar{display:flex;gap:6px;padding:8px}
input,select,textarea{font:12px var(--ff);color:var(--ink);background:var(--bg2);border:1px solid var(--ln);border-radius:6px;padding:5px 7px}
.bar input{flex:1;min-width:0}.bar select{max-width:110px}
.mode-bar{display:none;align-items:center;justify-content:space-between;padding:0 8px 6px}
.mode-bar.show{display:flex}
.seg{display:flex;background:var(--ln);border-radius:6px;padding:2px;gap:2px}
.seg-btn{border:0;background:none;color:var(--mu);font:600 11px var(--ff);padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap}
.seg-btn.on{background:var(--bg2);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.15)}
.meta{padding:0 10px 4px;color:var(--mu);font-size:11px}
.grid{flex:1 1 0;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:max-content;gap:8px;padding:4px 8px 8px;align-content:start}
.card{min-width:0;border:1px solid var(--ln);border-radius:6px;overflow:hidden;background:var(--bg2);cursor:pointer}
.card.on{outline:2px solid var(--ac);outline-offset:-1px}
.ph{position:relative;width:100%;padding-top:133.33%;background:var(--ln)}
.ph img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}
.cap{padding:3px 5px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ang{display:flex;flex-wrap:wrap;gap:2px;padding:2px 4px 5px}
.ang button{border:1px solid var(--ln);background:none;color:var(--mu);border-radius:4px;font-size:10px;padding:1px 5px;cursor:pointer;line-height:1.2;white-space:nowrap}
.ang button.on{background:var(--ac);border-color:var(--ac);color:#fff;font-weight:600}
.tray.warn{outline:2px solid #d9534f;outline-offset:-2px}
.tray{display:flex;gap:6px;padding:6px 8px;border-top:1px solid var(--ln)}
.slot{flex:1;display:flex;align-items:center;gap:6px;min-width:0;border:1px dashed var(--ln);border-radius:6px;padding:3px 5px;font-size:11px;color:var(--mu)}
.slot.slot-empty{cursor:pointer}
.slot.slot-empty:hover{border-color:var(--ac);color:var(--ac)}
.slot img{width:26px;height:34px;object-fit:cover;border-radius:3px;cursor:zoom-in;transition:transform .15s}
.slot img:hover{transform:scale(1.08)}
.slot span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slot button{border:0;background:none;color:var(--mu);cursor:pointer;flex-shrink:0;padding:0;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.slot button:hover{color:#d9534f}
.slot button svg{display:block;pointer-events:none}
.slot button.slot-add:hover{color:var(--ac)}
.slot.slot-empty:hover .slot-add{color:var(--ac)}
details{padding:4px 10px;border-top:1px solid var(--ln)}
summary{cursor:pointer;font-weight:600;font-size:12px}
.row{display:flex;gap:6px;margin:6px 0}.row input{flex:1;min-width:0}
textarea{width:100%;resize:vertical;margin-top:2px}
.link{border:0;background:none;color:var(--ac);cursor:pointer;font-size:11px;padding:2px 0}
.set-group label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;font-size:12px}
footer{position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--ln)}
#msg{flex:1;min-width:0;max-width:calc(50% - 30px);font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ver{position:absolute;left:50%;transform:translateX(-50%);font-size:11px;color:var(--mu);pointer-events:none;white-space:nowrap;user-select:none;-webkit-user-select:none}
.go{border:0;border-radius:6px;background:var(--ac);color:#fff;padding:7px 7px;font:600 12px var(--ff);cursor:pointer;white-space:nowrap;flex-shrink:0;margin-left:auto}
.go:disabled{opacity:.5;cursor:wait}
.grid-empty,.grid .empty{grid-column:1/-1;padding:30px 0;text-align:center;color:var(--mu)}
.modal-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:30;display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(2px)}
.modal{width:100%;max-height:92%;background:var(--bg2);border:1px solid var(--ln);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--ln);font:600 13px var(--ff);color:var(--ink)}
.modal-bd{padding:12px 14px;overflow-y:auto;font-size:12px;line-height:1.6;color:var(--ink)}
.modal-sec{margin-bottom:12px}
.modal-sec:last-child{margin-bottom:0}
.modal-title{font-weight:600;font-size:12px;color:var(--ink);margin-bottom:3px}
.modal-p{color:var(--mu);margin:0 0 4px}
.modal-ul{margin:0 0 6px;padding-left:16px;color:var(--mu)}
.modal-ul li{margin:2px 0}
.modal-a{color:var(--ac);text-decoration:none}
.modal-a:hover{text-decoration:underline}
.modal-ft{padding:8px 14px;border-top:1px solid var(--ln);display:flex;justify-content:flex-end}
.modal-ft.modal-ft-between{justify-content:space-between;align-items:center}
.modal-btn{border:1px solid var(--ln);background:var(--bg);color:var(--ink);padding:4px 12px;border-radius:4px;cursor:pointer;font:12px var(--ff)}
.modal-btn:hover{border-color:var(--ac);color:var(--ac)}
.modal-btn.primary{background:var(--ac);color:#fff;border-color:var(--ac)}
.modal-btn.primary:hover{opacity:.9;color:#fff}
.tour-overlay{position:fixed;inset:0;z-index:2147483646;overflow:hidden;pointer-events:auto}
.tour-backdrop{position:absolute;inset:0;background:transparent}
.tour-spotlight{position:absolute;border-radius:8px;border:2px solid var(--ac);box-shadow:0 0 0 9999px rgba(0,0,0,.62), 0 0 16px rgba(47,93,138,.55);pointer-events:none;transition:all .28s cubic-bezier(0.4, 0, 0.2, 1)}
.tour-popover{position:absolute;width:290px;max-width:calc(100vw - 28px);background:var(--bg2);border:1px solid var(--ln);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.45);padding:12px 14px;display:flex;flex-direction:column;gap:6px;z-index:2147483647;transition:all .28s cubic-bezier(0.4, 0, 0.2, 1)}
.tour-hd{display:flex;align-items:center;justify-content:space-between}
.tour-tag{font-size:11px;font-weight:600;color:var(--ac);background:rgba(47,93,138,.12);padding:2px 8px;border-radius:10px;line-height:1.2}
.tour-title{font-size:13px;font-weight:600;color:var(--ink);margin:3px 0 2px}
.tour-desc{font-size:12px;color:var(--mu);line-height:1.55;margin:0}
.tour-ft{display:flex;align-items:center;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid var(--ln)}
.tour-nav{display:flex;gap:6px}
.viewer-mask{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);user-select:none;-webkit-user-select:none}
.viewer-hd{position:absolute;top:16px;left:20px;right:20px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.viewer-title{color:#fff;font-size:13px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,.8);max-width:calc(100vw - 100px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viewer-close{pointer-events:auto;background:rgba(255,255,255,.2);border:0;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background-color .15s}
.viewer-close:hover{background:rgba(255,255,255,.38)}
.viewer-spin{position:absolute;display:flex;flex-direction:column;align-items:center;gap:12px;color:#fff;font-size:12px;pointer-events:none;z-index:2;text-shadow:0 1px 4px rgba(0,0,0,.8)}
.viewer-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:v-spin .8s linear infinite}
@keyframes v-spin{to{transform:rotate(360deg)}}
.viewer-img{max-width:min(90vw,1200px);max-height:85vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.7);cursor:zoom-out;transition:opacity .25s ease,filter .25s ease}
.viewer-img.loading{opacity:.65;filter:blur(5px)}
.viewer-img.loaded{opacity:1;filter:none}
`;
    // 不使用 innerHTML / <style> 字符串注入，避免 Trusted Types 与 CSP 拦截
    try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; }
    catch (_) { const st = document.createElement('style'); st.textContent = CSS; root.append(st); }

    const h = (tag, props, ...kids) => {
        const e = document.createElement(tag);
        if (props) for (const [k, v] of Object.entries(props)) {
            if (k === 'class') e.className = v;
            else if (k in e) e[k] = v;
            else e.setAttribute(k, v);
        }
        kids.flat().forEach((c) => e.append(c));
        return e;
    };
    const svgNS = 'http://www.w3.org/2000/svg';
    const makeIcon = (type, size) => {
        const s = document.createElementNS(svgNS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '2');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        let d = '';
        let w = size || 14;
        let h = size || 14;
        if (type === 'settings') {
            w = size || 14; h = size || 14;
            d = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z';
        } else if (type === 'help') {
            w = size || 14; h = size || 14;
            d = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01';
        } else if (type === 'about') {
            w = size || 14; h = size || 14;
            d = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 16v-4 M12 8h.01';
        } else if (type === 'close') {
            w = size || 14; h = size || 14;
            d = 'M19 5L5 19M5 5l14 14';
        } else if (type === 'plus') {
            w = size || 11; h = size || 11;
            d = 'M12 5v14M5 12h14';
        } else if (type === 'refresh') {
            w = size || 12; h = size || 12;
            d = 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15';
        } else if (type === 'moon') {
            w = size || 12; h = size || 12;
            d = 'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Z M12 3v18';
        }
        s.setAttribute('width', String(w));
        s.setAttribute('height', String(h));
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', d);
        s.append(p);
        return s;
    };
    const selK = (k, opts) => h('select', { 'data-k': k }, opts.map(([v, t]) => h('option', { value: v, textContent: t })));
    const chkK = (k) => h('input', { type: 'checkbox', 'data-k': k });
    const verText = (typeof GM_info !== 'undefined' && GM_info.script?.version) ? 'v' + GM_info.script.version : '';
    root.append(h('div', { class: 'r' },
        h('button', { class: 'fab', id: 'fab', title: 'Alt+Shift+R', textContent: '参考库' }),
        h('section', { class: 'panel', id: 'panel', hidden: true },
            h('div', { class: 'rh rh-nw', 'data-dir': 'nw' }),
            h('div', { class: 'rh rh-n', 'data-dir': 'n' }),
            h('div', { class: 'rh rh-ne', 'data-dir': 'ne' }),
            h('div', { class: 'rh rh-w', 'data-dir': 'w' }),
            h('div', { class: 'rh rh-e', 'data-dir': 'e' }),
            h('div', { class: 'rh rh-sw', 'data-dir': 'sw' }),
            h('div', { class: 'rh rh-s', 'data-dir': 's' }),
            h('div', { class: 'rh rh-se', 'data-dir': 'se' }),
            h('header', null,
                h('nav', { class: 'tabs', id: 'tabs' }),
                h('button', { class: 'h-icon', id: 'btn-settings', title: '设置' }, makeIcon('settings')),
                h('button', { class: 'h-icon', id: 'btn-about', title: '关于 / 数据来源' }, makeIcon('about')),
                h('button', { class: 'h-icon', id: 'btn-help', title: '操作说明' }, makeIcon('help')),
                h('button', { class: 'x', id: 'close', title: '关闭' }, makeIcon('close'))),
            h('div', { class: 'bar' }, h('input', { id: 'q', placeholder: '搜索 中文 / English / 编号' }), h('select', { id: 'f1' }), h('select', { id: 'f2' })),
            h('div', { class: 'mode-bar', id: 'mode-bar' },
                h('span', { style: 'font-size:11px;color:var(--mu);', textContent: '姿势图视图模式：' }),
                h('div', { class: 'seg' },
                    h('button', { class: 'seg-btn on', id: 'btn-norm', textContent: '3D 白模' }),
                    h('button', { class: 'seg-btn', id: 'btn-depth', textContent: '🌗 深度图' }))),
            h('div', { class: 'meta', id: 'meta' }),
            h('div', { class: 'grid', id: 'grid' }),
            h('div', { class: 'tray', id: 'tray' }),
            h('details', { open: true }, h('summary', null, '提示词'),
                h('div', { class: 'row' }, h('select', { id: 'style' }), h('input', { id: 'extra', placeholder: '补充描述（可选）' })),
                h('textarea', { id: 'ta', rows: 6 }),
                h('button', { class: 'link', id: 'reset', textContent: '重置为自动生成' })),
            h('footer', null, h('span', { id: 'msg' }), h('span', { id: 'ver', textContent: verText, hidden: !verText }), h('button', { class: 'go', id: 'go', textContent: '填充到对话框' })),
            h('div', { class: 'modal-mask', id: 'help-modal', hidden: true },
                h('div', { class: 'modal' },
                    h('div', { class: 'modal-hd' },
                        h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, makeIcon('help', 13), '操作说明与使用指南'),
                        h('button', { class: 'x', id: 'help-close', title: '关闭' }, makeIcon('close'))),
                    h('div', { class: 'modal-bd' },
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '1. 挑选与搭配参考图' }),
                            h('p', { class: 'modal-p', textContent: '点击上方「脸 / 服装 / 姿势」标签切换参考库，点击卡片即可选中作为当前生图参考。姿势库支持多视角切换，以及 3D 白模与 深度图 (Depth) 视图无缝切换。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '2. 添加本地自定义参考图' }),
                            h('p', { class: 'modal-p', textContent: '在底部参考图栏中，点击未选插槽右侧的「+」号按钮，即可上传你电脑里的本地图片，与官方参考库自由混合搭配。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '3. 原图放大查看与移除' }),
                            h('p', { class: 'modal-p', textContent: '点击底部托盘中已选参考图的缩略图，可立即全屏放大查看高清无损原图；点击右侧的取消按钮即可随时取消该参考图。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '4. 提示词风格与灵活补充' }),
                            h('p', { class: 'modal-p', textContent: '助手会自动生成符合主流生图模型规范的中英双语提示词。你可以在下拉框选择写实、二次元、2.5D等多种预设风格，或在文本框直接修改或输入补充描述。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '5. 一键填充至聊天输入框' }),
                            h('p', { class: 'modal-p', textContent: '选好参考图后，点击右下角「填充到对话框」，脚本会自动将高清参考图文件与提示词一键注入至当前 AI 对话框（支持在设置中开启填充后自动发送）。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '6. 快捷键与自由排版' }),
                            h('p', { class: 'modal-p', textContent: '• 全局快捷键：Alt + Shift + R 随时呼出或收起面板。' }),
                            h('p', { class: 'modal-p', textContent: '• 拖拽与缩放：按住面板标题栏或悬浮图标可任意拖动，拖拽面板边缘或四角可八向调整尺寸。' }))),
                    h('div', { class: 'modal-ft modal-ft-between' },
                        h('button', { class: 'btn-sub', id: 'btn-restart-guide', type: 'button', style: 'display:inline-flex;align-items:center;gap:4px' }, makeIcon('refresh', 12), '重新查看新手引导'),
                        h('button', { class: 'modal-btn', id: 'help-ok', textContent: '我知道了' })))),
            h('div', { class: 'tour-overlay', id: 'tour-overlay', hidden: true },
                h('div', { class: 'tour-backdrop', id: 'tour-backdrop' }),
                h('div', { class: 'tour-spotlight', id: 'tour-spotlight' }),
                h('div', { class: 'tour-popover', id: 'tour-popover' },
                    h('div', { class: 'tour-hd' },
                        h('span', { class: 'tour-tag', id: 'tour-tag' }),
                        h('button', { class: 'x', id: 'tour-close', title: '退出引导' }, makeIcon('close'))),
                    h('div', { class: 'tour-bd' },
                        h('div', { class: 'tour-title', id: 'tour-title' }),
                        h('p', { class: 'tour-desc', id: 'tour-desc' })),
                    h('div', { class: 'tour-ft' },
                        h('button', { class: 'link', id: 'tour-skip', type: 'button', textContent: '跳过' }),
                        h('div', { class: 'tour-nav' },
                            h('button', { class: 'modal-btn', id: 'tour-prev', textContent: '上一步' }),
                            h('button', { class: 'modal-btn primary', id: 'tour-next', textContent: '下一步' }))))),
            h('div', { class: 'modal-mask', id: 'settings-modal', hidden: true },
                h('div', { class: 'modal' },
                    h('div', { class: 'modal-hd' },
                        h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, makeIcon('settings', 14), '偏好设置'),
                        h('button', { class: 'x', id: 'settings-close', title: '关闭' }, makeIcon('close'))),
                    h('div', { class: 'modal-bd' },
                        h('div', { class: 'set-group' },
                            h('label', null, '弹框吸附方位', selK('dockPos', [['auto', '自动计算'], ['left', '固定在图标左边'], ['right', '固定在图标右边'], ['top', '固定在图标上方'], ['bottom', '固定在图标下方']])),
                            h('label', null, '注入图片方式', selK('method', [['auto', '自动'], ['paste', '粘贴'], ['drop', '拖放'], ['file', '文件框']])),
                            h('label', null, '填充顺序', selK('order', [['imgFirst', '先图后文'], ['textFirst', '先文后图']])),
                            h('label', null, '图片格式转换', selK('convert', [['jpeg', 'webp→JPEG'], ['png', 'webp→PNG'], ['none', '不转换']])),
                            h('label', null, '最多参考图数（留空=按站点，0=不限）', h('input', { type: 'number', min: 0, placeholder: '自动', 'data-k': 'maxImages', style: 'width:64px' })),
                            h('label', null, '追加到已有输入', chkK('append')),
                            h('label', null, '安全模式（隐藏性感 / 内衣 / 泳装 / 双人）', chkK('safe')),
                            h('label', null, '填充后自动发送', chkK('autoSend')),
                            h('label', null, '窗口与图标布局', h('button', { class: 'btn-sub', id: 'reset-layout', type: 'button', textContent: '重置位置与大小' })))),
                    h('div', { class: 'modal-ft' },
                        h('button', { class: 'modal-btn', id: 'settings-ok', textContent: '完成' })))),
            h('div', { class: 'modal-mask', id: 'about-modal', hidden: true },
                h('div', { class: 'modal' },
                    h('div', { class: 'modal-hd' },
                        h('span', null, '关于 / 数据来源与免责声明'),
                        h('button', { class: 'x', id: 'modal-close', title: '关闭' }, makeIcon('close'))),
                    h('div', { class: 'modal-bd' },
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '数据与素材致谢' }),
                            h('p', { class: 'modal-p' },
                                '本脚本展示的人像、服装、姿势参考库及检索数据基于开源项目 ',
                                h('a', { class: 'modal-a', href: 'https://github.com/anhao/ai-pose-gallery-zh', target: '_blank', rel: 'noopener noreferrer', textContent: 'anhao/ai-pose-gallery-zh' }),
                                '：'),
                            h('ul', { class: 'modal-ul' },
                                h('li', null, '姿势库、人像脸库与写实/动漫穿搭原作者：ギア ', h('a', { class: 'modal-a', href: 'https://x.com/giaaibusi', target: '_blank', rel: 'noopener noreferrer', textContent: '@giaaibusi' })),
                                h('li', null, '中国历代服饰库作者：Shisei（', h('a', { class: 'modal-a', href: 'https://www.shiseicostume.com/', target: '_blank', rel: 'noopener noreferrer', textContent: 'shiseicostume.com' }), ' · CC0）'),
                                h('li', null, '二次元服装库作者：たき AI ', h('a', { class: 'modal-a', href: 'https://x.com/taki_auto', target: '_blank', rel: 'noopener noreferrer', textContent: '@taki_auto' }), ' · CharaDB'))),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '版权与授权说明' }),
                            h('ul', { class: 'modal-ul' },
                                h('li', null, '人像脸库与中国历代服饰库遵循 CC0 1.0 Universal 公共领域贡献协议。'),
                                h('li', null, '姿势库、其余服装库图片素材严禁用于二次分发、商业打包或转售。'))),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '免责声明' }),
                            h('p', { class: 'modal-p', textContent: '1. 本脚本为前端辅助生图工具，只在运行时从公开 CDN 节点按需获取参考图，脚本本身不打包、不转储、不再分发任何版权图片。' }),
                            h('p', { class: 'modal-p', textContent: '2. 用户使用本工具所选取的参考图及在各 AI 对话平台生成的一切图像内容，均由使用者自行负责。请在遵守原素材开源协议、各生图平台服务条款及相关法律法规的前提下使用。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '开源协议与项目' }),
                            h('p', { class: 'modal-p' },
                                '脚本源码遵循 MIT License 开源协议，项目地址：',
                                h('a', { class: 'modal-a', href: 'https://github.com/yjiace/ai-ref-autofill', target: '_blank', rel: 'noopener noreferrer', textContent: 'yjiace/ai-ref-autofill' }),
                                '，欢迎提交 Issue 反馈或建议。'))),
                    h('div', { class: 'modal-ft' },
                        h('button', { class: 'modal-btn', id: 'modal-ok', textContent: '我知道了' })))),
            h('div', { class: 'viewer-mask', id: 'viewer-mask', hidden: true },
                h('div', { class: 'viewer-hd' },
                    h('span', { class: 'viewer-title', id: 'viewer-title' }),
                    h('button', { class: 'viewer-close', id: 'viewer-close', title: '关闭 (Esc)' }, makeIcon('close'))),
                h('div', { class: 'viewer-spin', id: 'viewer-spin' },
                    h('div', { class: 'viewer-spinner' }),
                    h('span', { id: 'viewer-spin-text', textContent: '正在加载高清原图…' })),
                h('img', { class: 'viewer-img', id: 'viewer-img' })))));

    const $ = (s) => root.querySelector(s);
    const ui = {
        fab: $('#fab'), panel: $('#panel'), tabs: $('#tabs'), q: $('#q'), f1: $('#f1'), f2: $('#f2'),
        modeBar: $('#mode-bar'), btnNorm: $('#btn-norm'), btnDepth: $('#btn-depth'),
        meta: $('#meta'), grid: $('#grid'), tray: $('#tray'), style: $('#style'), extra: $('#extra'),
        ta: $('#ta'), go: $('#go'), msg: $('#msg'), ver: $('#ver'),
        btnHelp: $('#btn-help'), btnSettings: $('#btn-settings'), btnAbout: $('#btn-about'),
        helpModal: $('#help-modal'), helpClose: $('#help-close'), helpOk: $('#help-ok'),
        btnRestartGuide: $('#btn-restart-guide'),
        tourOverlay: $('#tour-overlay'), tourSpotlight: $('#tour-spotlight'), tourPopover: $('#tour-popover'),
        tourTag: $('#tour-tag'), tourTitle: $('#tour-title'), tourDesc: $('#tour-desc'),
        tourClose: $('#tour-close'), tourSkip: $('#tour-skip'), tourPrev: $('#tour-prev'), tourNext: $('#tour-next'),
        aboutModal: $('#about-modal'), modalClose: $('#modal-close'), modalOk: $('#modal-ok'),
        settingsModal: $('#settings-modal'), settingsClose: $('#settings-close'), settingsOk: $('#settings-ok'),
        viewerMask: $('#viewer-mask'), viewerTitle: $('#viewer-title'), viewerImg: $('#viewer-img'), viewerClose: $('#viewer-close'),
        viewerSpin: $('#viewer-spin'), viewerSpinText: $('#viewer-spin-text'),
        resetLayout: $('#reset-layout')
    };
    const msg = (t) => { ui.msg.textContent = t; };
    const cardMap = new Map();

    const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); setThumb(e.target, e.target.dataset.rel); } });
    }, { root: ui.grid, rootMargin: '200px' });

    function visibleItems() {
        const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return (state.items[state.tab] || []).filter((it) =>
            (!settings.safe || !it.nsfw) && (!state.f1 || it.cat === state.f1) && (!state.f2 || it.cat2 === state.f2) && words.every((w) => it.search.includes(w)));
    }

    function updateSubFilter(keepVal) {
        const items = (state.items[state.tab] || []).filter((it) => (!settings.safe || !it.nsfw) && (!state.f1 || it.cat === state.f1));
        const [, l2] = LABELS[state.tab];
        ui.f2.hidden = !l2;
        if (!l2) { state.f2 = ''; return; }
        const vals = [...new Set(items.map((i) => i.cat2).filter(Boolean))];
        ui.f2.replaceChildren(h('option', { value: '', textContent: '全部' + l2 }), ...vals.map((v) => h('option', { value: v, textContent: v })));
        if (keepVal && state.f2 && vals.includes(state.f2)) {
            ui.f2.value = state.f2;
        } else {
            state.f2 = '';
            ui.f2.value = '';
        }
    }

    function renderFilters() {
        const items = (state.items[state.tab] || []).filter((it) => !settings.safe || !it.nsfw);
        const [l1] = LABELS[state.tab];
        ui.f1.hidden = !l1;
        if (l1) {
            const vals = [...new Set(items.map((i) => i.cat).filter(Boolean))];
            ui.f1.replaceChildren(h('option', { value: '', textContent: '全部' + l1 }), ...vals.map((v) => h('option', { value: v, textContent: v })));
        }
        state.f1 = '';
        state.f2 = '';
        updateSubFilter(false);
    }

    function renderGrid() {
        ui.grid.replaceChildren(); cardMap.clear();
        state.list = visibleItems(); state.shown = 0;
        const depthNote = (state.tab === 'pose' && state.poseDepth) ? ' · 深度图视图' : '';
        ui.meta.textContent = '共 ' + state.list.length + ' 项' + (settings.safe ? '（安全模式）' : '') + depthNote + (getLimit() ? ' · 本站最多选 ' + getLimit() + ' 张参考图' : '');
        if (!state.list.length) { ui.grid.replaceChildren(h('div', { class: 'empty', textContent: '没有匹配的内容' })); return; }
        more();
    }
    function more() {
        state.list.slice(state.shown, state.shown + 48).forEach((it) => ui.grid.appendChild(card(it)));
        state.shown = Math.min(state.shown + 48, state.list.length);
    }
    ui.grid.addEventListener('scroll', () => {
        if (state.shown < state.list.length && ui.grid.scrollTop + ui.grid.clientHeight > ui.grid.scrollHeight - 500) more();
    });

    const isSel = (it) => {
        const s = state.sel[it.lib];
        if (!s || s.item !== it) return false;
        if (it.angles && s.ai !== it.cur) return false;
        if (it.lib === 'pose' && s.isDepth !== state.poseDepth) return false;
        return true;
    };

    function card(it) {
        const d = document.createElement('div'); d.className = 'card' + (isSel(it) ? ' on' : '');
        const currentRel = thumbOf(it, state.poseDepth);
        const img = document.createElement('img'); img.dataset.rel = currentRel;
        const ph = document.createElement('div'); ph.className = 'ph'; ph.appendChild(img);
        const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = it.title; cap.title = it.title;
        d.append(ph, cap);
        if (it.angles && it.angles.length > 1) {
            const a = document.createElement('div'); a.className = 'ang';
            it.angles.forEach((ag, i) => {
                const b = document.createElement('button');
                b.textContent = ag.angle || (i + 1);
                b.className = i === it.cur ? 'on' : '';
                b.title = (ag.angle || '') + '视角';
                b.onclick = (ev) => {
                    ev.stopPropagation();
                    it.cur = i;
                    a.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i));
                    const newRel = thumbOf(it, state.poseDepth);
                    img.dataset.rel = newRel;
                    setThumb(img, newRel);
                    select(it, true);
                };
                a.appendChild(b);
            });
            d.appendChild(a);
        }
        d.onclick = () => select(it);
        cardMap.set(it, d); io.observe(img);
        return d;
    }

    let uploadTargetLib = null;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
    fileInput.style.display = 'none';
    root.append(fileInput);

    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file || !uploadTargetLib) return;
        if (!file.type || !file.type.startsWith('image/')) {
            msg('请选择有效的图片文件');
            return;
        }
        const lim = getLimit();
        if (!state.sel[uploadTargetLib] && lim && Object.keys(state.sel).length >= lim) {
            msg('本站生图模式最多支持 ' + lim + ' 张参考图，请先取消已选的一项');
            ui.tray.classList.add('warn');
            setTimeout(() => ui.tray.classList.remove('warn'), 1500);
            return;
        }

        if (state.sel[uploadTargetLib]?.isCustom && state.sel[uploadTargetLib]?.url) {
            try { URL.revokeObjectURL(state.sel[uploadTargetLib].url); } catch (_) { }
        }

        const url = URL.createObjectURL(file);
        state.sel[uploadTargetLib] = {
            isCustom: true,
            file,
            url,
            item: {
                lib: uploadTargetLib,
                id: 'custom-' + uploadTargetLib + '-' + Date.now(),
                title: file.name.replace(/\.[^.]+$/, '') || file.name,
                full: url,
                thumb: url
            },
            ai: 0,
            isDepth: false,
        };

        const targetLib = uploadTargetLib;
        cardMap.forEach((el, k) => el.classList.toggle('on', isSel(k)));
        renderTray();
        refreshPrompt();

        const labelName = targetLib === 'face' ? '人脸' : targetLib === 'costume' ? '服装' : '动作';
        msg('已选择自定义' + labelName + '参考图');

        autoAdvanceTab(targetLib);
    });

    function autoAdvanceTab(currentLib) {
        const tabs = ['face', 'costume', 'pose'];
        const idx = tabs.indexOf(currentLib);
        if (idx === -1) return;
        for (let i = idx + 1; i < tabs.length; i++) {
            const next = tabs[i];
            if (!state.sel[next]) {
                switchTab(next);
                return;
            }
        }
    }

    function select(it, forceOn) {
        const turningOn = !(isSel(it) && !forceOn);
        const lim = getLimit();
        if (turningOn && !state.sel[it.lib] && lim && Object.keys(state.sel).length >= lim) {
            msg('本站生图模式最多支持 ' + lim + ' 张参考图，请先取消已选的一项');
            ui.tray.classList.add('warn'); setTimeout(() => ui.tray.classList.remove('warn'), 1500);
            return;
        }
        if (state.sel[it.lib]?.isCustom && state.sel[it.lib]?.url) {
            try { URL.revokeObjectURL(state.sel[it.lib].url); } catch (_) { }
        }
        if (isSel(it) && !forceOn) {
            delete state.sel[it.lib];
        } else {
            state.sel[it.lib] = {
                item: it,
                ai: it.cur,
                isDepth: it.lib === 'pose' ? !!state.poseDepth : false,
            };
        }
        cardMap.forEach((el, k) => el.classList.toggle('on', isSel(k)));
        renderTray(); refreshPrompt();

        if (turningOn) {
            autoAdvanceTab(it.lib);
        }
    }

    let viewerLoadId = 0;
    function openImageViewer(s, label) {
        if (!s) return;
        viewerLoadId++;
        const currentLoadId = viewerLoadId;

        const lib = s.item?.lib;
        const angName = (s.item?.angles && s.item?.angles[s.ai]) ? s.item.angles[s.ai].angle : '';
        const depthBadge = (lib === 'pose' && s.isDepth) ? ' [深度图]' : '';
        const customBadge = s.isCustom ? ' [自定义]' : '';
        ui.viewerTitle.textContent = label + '参考：' + (s.item?.title || '自定义图片') + (angName ? '·' + angName : '') + depthBadge + customBadge;

        ui.viewerMask.hidden = false;

        // 本地自定义图片直接呈现完整画质，跳过加载状态
        if (s.isCustom && s.url) {
            ui.viewerSpin.hidden = true;
            ui.viewerImg.className = 'viewer-img loaded';
            ui.viewerImg.src = s.url;
            return;
        }

        // 库内图片启动两阶段加载动效
        ui.viewerSpin.hidden = false;
        ui.viewerSpinText.textContent = '正在加载高清原图…';
        ui.viewerImg.className = 'viewer-img loading';

        // 阶段一：用已有的缩略图立即占位展示，0毫秒感知延迟
        const thumbRel = (lib === 'pose' ? thumbOf(s.item, s.isDepth) : thumbOf(s.item));
        if (thumbRel && tcache.has(thumbRel)) {
            thumbURL(thumbRel).then((u) => {
                if (currentLoadId === viewerLoadId && ui.viewerImg.classList.contains('loading')) {
                    ui.viewerImg.src = u;
                }
            }).catch(() => { });
        }

        // 阶段二：后台预加载全尺寸高清原图
        const fullRel = (lib === 'pose' ? fullOf(s.item, s.ai, s.isDepth) : fullOf(s.item, s.ai)) || thumbRel;
        if (!fullRel) {
            ui.viewerSpin.hidden = true;
            ui.viewerImg.className = 'viewer-img loaded';
            return;
        }

        const handleReadyUrl = (u) => {
            if (currentLoadId !== viewerLoadId) return;
            const pre = new Image();
            pre.onload = () => {
                if (currentLoadId !== viewerLoadId) return;
                ui.viewerImg.src = u;
                ui.viewerImg.className = 'viewer-img loaded';
                ui.viewerSpin.hidden = true;
            };
            pre.onerror = () => {
                if (currentLoadId !== viewerLoadId) return;
                ui.viewerImg.className = 'viewer-img loaded';
                ui.viewerSpinText.textContent = '高清原图加载失败';
                setTimeout(() => {
                    if (currentLoadId === viewerLoadId) ui.viewerSpin.hidden = true;
                }, 1500);
            };
            pre.src = u;
        };

        if (isAbs(fullRel)) {
            handleReadyUrl(fullRel);
        } else {
            thumbURL(fullRel).then((u) => {
                handleReadyUrl(u);
            }).catch(() => {
                if (currentLoadId !== viewerLoadId) return;
                ui.viewerImg.className = 'viewer-img loaded';
                ui.viewerSpinText.textContent = '原图加载失败';
                setTimeout(() => {
                    if (currentLoadId === viewerLoadId) ui.viewerSpin.hidden = true;
                }, 1500);
            });
        }
    }

    function closeImageViewer() {
        viewerLoadId++;
        ui.viewerMask.hidden = true;
        ui.viewerSpin.hidden = true;
        ui.viewerImg.src = '';
        ui.viewerImg.className = 'viewer-img';
    }

    function renderTray() {
        ui.tray.replaceChildren();
        LIBS.forEach(([lib, label]) => {
            const s = state.sel[lib];
            const d = document.createElement('div');
            if (!s) {
                d.className = 'slot slot-empty';
                d.title = label + '：未选，点击添加自定义本地图片';

                const t = document.createElement('span');
                t.textContent = label + '：未选';

                const plusBtn = document.createElement('button');
                plusBtn.className = 'slot-add';
                plusBtn.type = 'button';
                plusBtn.title = '添加自定义图片';
                plusBtn.appendChild(makeIcon('plus'));

                d.append(t, plusBtn);
                d.onclick = () => {
                    uploadTargetLib = lib;
                    fileInput.value = '';
                    fileInput.click();
                };
            } else {
                d.className = 'slot';
                const im = document.createElement('img');
                im.title = '点击放大查看原图';
                im.onclick = (ev) => {
                    ev.stopPropagation();
                    openImageViewer(s, label);
                };
                if (s.isCustom) {
                    im.src = s.url;
                } else {
                    const rel = lib === 'pose'
                        ? posePath(s.item.angles ? s.item.angles[s.ai]?.thumb : s.item.thumb, 'thumb', s.isDepth)
                        : (s.item.angles ? s.item.angles[s.ai]?.thumb : s.item.thumb);
                    setThumb(im, rel);
                }
                const angName = (s.item.angles && s.item.angles[s.ai]) ? s.item.angles[s.ai].angle : '';
                const depthBadge = (lib === 'pose' && s.isDepth) ? ' [深度图]' : '';
                const customBadge = s.isCustom ? ' [自定义]' : '';
                const t = document.createElement('span');
                t.textContent = label + '：' + (s.item.title || '自定义') + (angName ? '·' + angName : '') + depthBadge + customBadge;
                t.title = t.textContent;
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'slot-del';
                x.title = '取消选择';
                x.appendChild(makeIcon('close', 10));
                x.onclick = (ev) => {
                    ev.stopPropagation();
                    if (s.isCustom && s.url) {
                        try { URL.revokeObjectURL(s.url); } catch (_) { }
                    }
                    delete state.sel[lib];
                    cardMap.forEach((el, k) => el.classList.toggle('on', isSel(k)));
                    renderTray();
                    refreshPrompt();
                };
                d.append(im, t, x);
            }
            ui.tray.appendChild(d);
        });
        ui.go.disabled = !Object.keys(state.sel).length;
    }

    async function switchTab(tab) {
        state.tab = tab;
        ui.tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
        ui.modeBar.classList.toggle('show', tab === 'pose');
        ui.grid.replaceChildren(h('div', { class: 'empty', textContent: '加载中…' })); ui.meta.textContent = '';
        try { await ensureLib(tab); }
        catch (e) { ui.grid.replaceChildren(h('div', { class: 'empty' }, '加载失败：' + e.message, h('br'), '可在 CONFIG 里更换数据源')); return; }
        if (state.tab !== tab) return;
        renderFilters(); renderGrid();
    }

    /* 初始化 UI */
    LIBS.forEach(([k, n]) => {
        const b = document.createElement('button'); b.className = 'tab'; b.dataset.t = k; b.textContent = n;
        b.onclick = () => switchTab(k); ui.tabs.appendChild(b);
    });
    STYLES.forEach(([n, v]) => { const o = document.createElement('option'); o.textContent = n; o.value = v; ui.style.appendChild(o); });
    ui.style.value = settings.style;
    ui.style.onchange = () => { settings.style = ui.style.value; saveSettings(); refreshPrompt(); };
    ui.extra.oninput = refreshPrompt;
    ui.ta.oninput = () => { state.dirty = true; };
    $('#reset').onclick = () => { state.dirty = false; refreshPrompt(); };
    root.querySelectorAll('[data-k]').forEach((c) => {
        const k = c.dataset.k;
        if (c.type === 'checkbox') c.checked = !!settings[k]; else c.value = settings[k];
        c.onchange = () => {
            settings[k] = c.type === 'checkbox' ? c.checked : c.value; saveSettings();
            if (k === 'safe') { renderFilters(); renderGrid(); }
            if (k === 'maxImages') renderGrid();
            if (k === 'dockPos' && !ui.panel.hidden) anchorPanel();
        };
    });
    let tmr; ui.q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = ui.q.value; renderGrid(); }, 150); };
    ui.f1.onchange = () => { state.f1 = ui.f1.value; updateSubFilter(true); renderGrid(); };
    ui.f2.onchange = () => { state.f2 = ui.f2.value; renderGrid(); };

    const setPoseDepth = (depth) => {
        if (state.poseDepth === depth) return;
        state.poseDepth = depth;
        ui.btnNorm.classList.toggle('on', !depth);
        ui.btnDepth.classList.toggle('on', depth);
        renderGrid();
    };
    ui.btnNorm.onclick = () => setPoseDepth(false);
    ui.btnDepth.onclick = () => setPoseDepth(true);

    ui.go.onclick = fillChat;

    const closeAllModals = () => {
        ui.aboutModal.hidden = true;
        ui.settingsModal.hidden = true;
        ui.helpModal.hidden = true;
        ui.tourOverlay.hidden = true;
        closeImageViewer();
    };
    const openModal = (m) => {
        closeAllModals();
        m.hidden = false;
    };

    const TOUR_STEPS = [
        {
            tag: '步骤 1 / 4',
            title: '🎨 挑选与切换参考库',
            desc: '在顶部切换脸部、服装、姿势图库，点击卡片即可选入参考图；姿势库更支持多视角与 3D 深度图 (Depth) 切换。',
            placement: 'bottom',
            getTarget: () => ui.tabs,
            onBefore: () => { }
        },
        {
            tag: '步骤 2 / 4',
            title: '📁 槽位托盘与本地上传',
            desc: '已选参考图在此呈现。点击缩略图可全屏查看高清原图；点击未选槽位右侧的「+」可直接上传本地图片混合搭配。',
            placement: 'top',
            getTarget: () => ui.tray,
            onBefore: () => { }
        },
        {
            tag: '步骤 3 / 4',
            title: '✍️ 提示词风格与灵活补充',
            desc: '系统会根据选图自动生成双语生图 Prompt。你可以在下拉框选择写实、二次元等预设风格，或在文本框直接输入补充要求。',
            placement: 'top',
            getTarget: () => ui.panel.querySelector('details'),
            onBefore: () => {
                const det = ui.panel.querySelector('details');
                if (det) det.open = true;
            }
        },
        {
            tag: '步骤 4 / 4',
            title: '🚀 一键注入到对话框',
            desc: '选好参考图后，点击此处即可把高清图片与提示词一键填入聊天框！全局快捷键 Alt + Shift + R 可随时呼出/收起面板。',
            placement: 'top',
            getTarget: () => ui.go,
            onBefore: () => { }
        }
    ];

    let currentTourStep = 0;
    function updateTourPos() {
        if (ui.tourOverlay.hidden) return;
        const step = TOUR_STEPS[currentTourStep];
        if (!step) return;
        const target = step.getTarget();
        if (!target) return;

        if (step.onBefore) step.onBefore();

        const rect = target.getBoundingClientRect();
        const pad = 4;
        const sLeft = Math.max(0, rect.left - pad);
        const sTop = Math.max(0, rect.top - pad);
        const sWidth = rect.width + pad * 2;
        const sHeight = rect.height + pad * 2;

        ui.tourSpotlight.style.left = sLeft + 'px';
        ui.tourSpotlight.style.top = sTop + 'px';
        ui.tourSpotlight.style.width = sWidth + 'px';
        ui.tourSpotlight.style.height = sHeight + 'px';

        const popW = Math.min(290, window.innerWidth - 24);
        ui.tourPopover.style.width = popW + 'px';
        const popH = ui.tourPopover.offsetHeight || 150;

        let pTop;
        if (step.placement === 'bottom' || (sTop < popH + 20 && sTop + sHeight + popH + 20 < window.innerHeight)) {
            pTop = sTop + sHeight + 8;
        } else {
            pTop = Math.max(12, sTop - popH - 8);
        }

        let pLeft = Math.max(12, Math.min(sLeft + (sWidth - popW) / 2, window.innerWidth - popW - 12));

        ui.tourPopover.style.left = pLeft + 'px';
        ui.tourPopover.style.top = pTop + 'px';
    }

    function renderTourStep(idx) {
        currentTourStep = idx;
        const step = TOUR_STEPS[idx];
        ui.tourTag.textContent = step.tag;
        ui.tourTitle.textContent = step.title;
        ui.tourDesc.textContent = step.desc;

        ui.tourPrev.hidden = idx === 0;
        ui.tourNext.textContent = idx === TOUR_STEPS.length - 1 ? '完成并开始使用' : '下一步';

        requestAnimationFrame(() => {
            updateTourPos();
        });
    }

    function startTour(idx = 0) {
        closeAllModals();
        if (ui.panel.hidden) toggle(true);
        ui.tourOverlay.hidden = false;
        renderTourStep(idx);
    }

    function closeTour() {
        ui.tourOverlay.hidden = true;
        try { GM_setValue('guide_completed_v1', true); } catch (_) { }
    }

    function checkFirstRunGuide() {
        const completed = GM_getValue('guide_completed_v1', false);
        if (!completed) {
            setTimeout(() => {
                if (!ui.panel.hidden && ui.aboutModal.hidden && ui.settingsModal.hidden && ui.helpModal.hidden) {
                    startTour(0);
                }
            }, 300);
        }
    }

    ui.btnHelp.onclick = (e) => { e.stopPropagation(); openModal(ui.helpModal); };
    ui.helpClose.onclick = closeAllModals;
    ui.helpOk.onclick = closeAllModals;
    ui.helpModal.onclick = (e) => { if (e.target === ui.helpModal) closeAllModals(); };

    ui.btnRestartGuide.onclick = (e) => {
        e.stopPropagation();
        startTour(0);
    };

    ui.tourClose.onclick = closeTour;
    ui.tourSkip.onclick = closeTour;
    ui.tourPrev.onclick = () => {
        if (currentTourStep > 0) renderTourStep(currentTourStep - 1);
    };
    ui.tourNext.onclick = () => {
        if (currentTourStep < TOUR_STEPS.length - 1) {
            renderTourStep(currentTourStep + 1);
        } else {
            closeTour();
        }
    };

    ui.btnAbout.onclick = (e) => { e.stopPropagation(); openModal(ui.aboutModal); };
    ui.modalClose.onclick = closeAllModals;
    ui.modalOk.onclick = closeAllModals;
    ui.aboutModal.onclick = (e) => { if (e.target === ui.aboutModal) closeAllModals(); };

    ui.btnSettings.onclick = (e) => { e.stopPropagation(); openModal(ui.settingsModal); };
    ui.settingsClose.onclick = closeAllModals;
    ui.settingsOk.onclick = closeAllModals;
    ui.settingsModal.onclick = (e) => { if (e.target === ui.settingsModal) closeAllModals(); };

    ui.viewerClose.onclick = closeImageViewer;
    ui.viewerMask.onclick = (e) => {
        if (e.target === ui.viewerMask || e.target === ui.viewerImg) closeImageViewer();
    };

    /* ───────────── 拖拽、缩放、锚定与位置持久化 ───────────── */
    function defaultFabPos() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
            x: Math.max(8, vw - 88 - 16),
            y: Math.max(8, vh - 38 - 96),
        };
    }
    function getStoredFabPos() {
        return GM_getValue('fab_pos', null);
    }
    function saveFabPos(pos) {
        try { GM_setValue('fab_pos', pos); } catch (_) { }
    }
    function clampFabPos(pos) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const fw = ui.fab.offsetWidth || 88;
        const fh = ui.fab.offsetHeight || 38;
        const x = Math.max(8, Math.min(pos.x, vw - fw - 8));
        const y = Math.max(8, Math.min(pos.y, vh - fh - 8));
        return { x, y };
    }
    function applyFabPos(pos) {
        const p = clampFabPos(pos);
        ui.fab.style.left = p.x + 'px';
        ui.fab.style.top = p.y + 'px';
        ui.fab.style.right = 'auto';
        ui.fab.style.bottom = 'auto';
        return p;
    }

    function getStoredRect() {
        return GM_getValue('panel_rect', null);
    }
    function saveRect(rect) {
        try { GM_setValue('panel_rect', rect); } catch (_) { }
    }

    function anchorPanel() {
        const fabRect = ui.fab.getBoundingClientRect();
        const stored = getStoredRect() || {};
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pw = Math.max(320, Math.min(stored.w || 440, vw - 16));
        const ph = Math.max(360, Math.min(stored.h || Math.min(Math.round(vh * 0.86), 780), vh - 16));
        const GAP = 10;

        const leftSpace = fabRect.left - GAP - 8;
        const rightSpace = vw - fabRect.right - GAP - 8;
        const topSpace = fabRect.top - GAP - 8;
        const bottomSpace = vh - fabRect.bottom - GAP - 8;

        let placement = settings.dockPos || 'auto';

        if (placement === 'auto') {
            const isRightHalf = (fabRect.left + fabRect.width / 2) > (vw / 2);
            const isBottomHalf = (fabRect.top + fabRect.height / 2) > (vh / 2);
            if (isRightHalf && leftSpace >= pw) {
                placement = 'left';
            } else if (!isRightHalf && rightSpace >= pw) {
                placement = 'right';
            } else if (isBottomHalf && topSpace >= ph) {
                placement = 'top';
            } else if (!isBottomHalf && bottomSpace >= ph) {
                placement = 'bottom';
            } else {
                const maxSpace = Math.max(leftSpace, rightSpace, topSpace, bottomSpace);
                if (maxSpace === leftSpace) placement = 'left';
                else if (maxSpace === rightSpace) placement = 'right';
                else if (maxSpace === topSpace) placement = 'top';
                else placement = 'bottom';
            }
        }

        let targetX = 0;
        let targetY = 0;

        if (placement === 'left') {
            targetX = fabRect.left - GAP - pw;
            if (targetX < 8 && rightSpace > leftSpace) {
                targetX = fabRect.right + GAP;
            }
            targetY = fabRect.bottom - ph;
        } else if (placement === 'right') {
            targetX = fabRect.right + GAP;
            if (targetX + pw > vw - 8 && leftSpace > rightSpace) {
                targetX = fabRect.left - GAP - pw;
            }
            targetY = fabRect.bottom - ph;
        } else if (placement === 'top') {
            targetY = fabRect.top - GAP - ph;
            if (targetY < 8 && bottomSpace > topSpace) {
                targetY = fabRect.bottom + GAP;
            }
            targetX = fabRect.right - pw;
        } else if (placement === 'bottom') {
            targetY = fabRect.bottom + GAP;
            if (targetY + ph > vh - 8 && topSpace > bottomSpace) {
                targetY = fabRect.top - GAP - ph;
            }
            targetX = fabRect.right - pw;
        }

        targetX = Math.max(8, Math.min(targetX, vw - pw - 8));
        targetY = Math.max(8, Math.min(targetY, vh - ph - 8));

        ui.panel.style.left = targetX + 'px';
        ui.panel.style.top = targetY + 'px';
        ui.panel.style.right = 'auto';
        ui.panel.style.bottom = 'auto';
        ui.panel.style.width = pw + 'px';
        ui.panel.style.height = ph + 'px';

        saveRect({ x: targetX, y: targetY, w: pw, h: ph });
        return { x: targetX, y: targetY, w: pw, h: ph };
    }

    /* 浮动图标 (FAB) 拖拽手势 */
    let fabDrag = { active: false, moved: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 };
    ui.fab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        fabDrag.active = true;
        fabDrag.moved = false;
        fabDrag.startX = e.clientX;
        fabDrag.startY = e.clientY;
        const rect = ui.fab.getBoundingClientRect();
        fabDrag.initLeft = rect.left;
        fabDrag.initTop = rect.top;
        ui.fab.setPointerCapture(e.pointerId);
    });

    ui.fab.addEventListener('pointermove', (e) => {
        if (!fabDrag.active) return;
        const dx = e.clientX - fabDrag.startX;
        const dy = e.clientY - fabDrag.startY;
        if (!fabDrag.moved && Math.hypot(dx, dy) > 4) {
            fabDrag.moved = true;
            state.fabDragging = true;
            ui.fab.classList.add('grabbing');
        }
        if (fabDrag.moved) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const fw = ui.fab.offsetWidth || 88;
            const fh = ui.fab.offsetHeight || 38;
            const nx = Math.max(8, Math.min(fabDrag.initLeft + dx, vw - fw - 8));
            const ny = Math.max(8, Math.min(fabDrag.initTop + dy, vh - fh - 8));
            applyFabPos({ x: nx, y: ny });
            if (!ui.panel.hidden) {
                anchorPanel();
            }
        }
    });

    const onFabUp = (e) => {
        if (!fabDrag.active) return;
        fabDrag.active = false;
        ui.fab.classList.remove('grabbing');
        try { ui.fab.releasePointerCapture(e.pointerId); } catch (_) { }
        if (fabDrag.moved) {
            const cur = ui.fab.getBoundingClientRect();
            saveFabPos({ x: cur.left, y: cur.top });
            setTimeout(() => { state.fabDragging = false; }, 60);
        } else {
            state.fabDragging = false;
            toggle();
        }
    };
    ui.fab.addEventListener('pointerup', onFabUp);
    ui.fab.addEventListener('pointercancel', onFabUp);

    /* 面板标题栏拖动联动 */
    const headerEl = ui.panel.querySelector('header');
    headerEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, nav, input, select')) return;
        e.preventDefault();
        state.dragging = true;
        headerEl.classList.add('grabbing');
        ui.panel.classList.add('dragging');
        const pRect = ui.panel.getBoundingClientRect();
        const fRect = ui.fab.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const initPLeft = pRect.left;
        const initPTop = pRect.top;
        const initFLeft = fRect.left;
        const initFTop = fRect.top;
        const pw = pRect.width;
        const ph = pRect.height;
        const fw = fRect.width;
        const fh = fRect.height;

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            const newPX = Math.max(8, Math.min(initPLeft + dx, vw - pw - 8));
            const newPY = Math.max(8, Math.min(initPTop + dy, vh - ph - 8));
            const effectiveDX = newPX - initPLeft;
            const effectiveDY = newPY - initPTop;

            ui.panel.style.left = newPX + 'px';
            ui.panel.style.top = newPY + 'px';

            const newFX = Math.max(8, Math.min(initFLeft + effectiveDX, vw - fw - 8));
            const newFY = Math.max(8, Math.min(initFTop + effectiveDY, vh - fh - 8));
            applyFabPos({ x: newFX, y: newFY });
        };
        const onUp = () => {
            state.dragging = false;
            headerEl.classList.remove('grabbing');
            ui.panel.classList.remove('dragging');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const curP = ui.panel.getBoundingClientRect();
            saveRect({ x: curP.left, y: curP.top, w: curP.width, h: curP.height });
            const curF = ui.fab.getBoundingClientRect();
            saveFabPos({ x: curF.left, y: curF.top });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });

    /* 缩放手柄 */
    root.querySelectorAll('.rh').forEach((rh) => {
        rh.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            state.resizing = true;
            ui.panel.classList.add('dragging');
            const dir = rh.dataset.dir;
            const rect = ui.panel.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const initLeft = rect.left;
            const initTop = rect.top;
            const initW = rect.width;
            const initH = rect.height;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                let newLeft = initLeft;
                let newTop = initTop;
                let newW = initW;
                let newH = initH;

                if (dir.includes('e')) {
                    newW = Math.max(320, Math.min(initW + dx, vw - initLeft - 8));
                }
                if (dir.includes('s')) {
                    newH = Math.max(360, Math.min(initH + dy, vh - initTop - 8));
                }
                if (dir.includes('w')) {
                    const proposedW = initW - dx;
                    if (proposedW >= 320) {
                        const proposedLeft = initLeft + dx;
                        if (proposedLeft >= 8) {
                            newW = proposedW;
                            newLeft = proposedLeft;
                        }
                    }
                }
                if (dir.includes('n')) {
                    const proposedH = initH - dy;
                    if (proposedH >= 360) {
                        const proposedTop = initTop + dy;
                        if (proposedTop >= 8) {
                            newH = proposedH;
                            newTop = proposedTop;
                        }
                    }
                }

                ui.panel.style.left = newLeft + 'px';
                ui.panel.style.top = newTop + 'px';
                ui.panel.style.right = 'auto';
                ui.panel.style.bottom = 'auto';
                ui.panel.style.width = newW + 'px';
                ui.panel.style.height = newH + 'px';
            };

            const onUp = () => {
                state.resizing = false;
                ui.panel.classList.remove('dragging');
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                const cur = ui.panel.getBoundingClientRect();
                saveRect({ x: cur.left, y: cur.top, w: cur.width, h: cur.height });
                anchorPanel();
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    });

    /* 重置布局 */
    function resetLayout() {
        try {
            GM_deleteValue('fab_pos');
            GM_deleteValue('panel_rect');
        } catch (_) { }
        const defFab = defaultFabPos();
        applyFabPos(defFab);
        saveFabPos(defFab);

        const vh = window.innerHeight;
        const defaultRect = {
            w: 440,
            h: Math.min(Math.round(vh * 0.86), 780),
        };
        saveRect(defaultRect);
        anchorPanel();
        msg('已重置图标位置与弹框默认大小');
    }
    ui.resetLayout.onclick = resetLayout;

    function toggle(open) {
        const show = open ?? ui.panel.hidden;
        ui.panel.hidden = !show;
        ui.fab.classList.toggle('active', show);
        if (show) {
            anchorPanel();
            if (!state.items[state.tab] && !state.loading) switchTab(state.tab);
            checkFirstRunGuide();
        } else {
            closeAllModals();
        }
    }
    $('#close').onclick = () => toggle(false);
    addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && e.code === 'KeyR') toggle();
        if (e.key === 'Escape' && (!ui.aboutModal.hidden || !ui.settingsModal.hidden || !ui.helpModal.hidden || !ui.tourOverlay.hidden || !ui.viewerMask.hidden)) closeAllModals();
    }, true);

    // 点击区域外自动隐藏面板
    addEventListener('pointerdown', (e) => {
        if (ui.panel.hidden) return;
        if (state.dragging || state.resizing || state.fabDragging || !ui.tourOverlay.hidden) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.includes(host) || path.includes(ui.panel) || path.includes(ui.fab) || path.includes(ui.viewerMask) || path.includes(ui.tourOverlay)) return;
        toggle(false);
    }, true);

    // 窗口尺寸变化时自适应边界
    addEventListener('resize', () => {
        const curFab = getStoredFabPos() || defaultFabPos();
        applyFabPos(curFab);
        if (!ui.panel.hidden) {
            anchorPanel();
            updateTourPos();
        }
    });

    renderTray(); refreshPrompt();
    switchTab('face').then(() => { /* 预热第一个库 */ });
    ui.panel.hidden = true;
    const initialFab = getStoredFabPos() || defaultFabPos();
    applyFabPos(initialFab);

    const mount = () => {
        try {
            const target = document.documentElement;
            if (target && !host.isConnected) target.appendChild(host);
        } catch (e) { console.error('[ai-ref] 挂载失败', e); }
    };
    mount();
    setInterval(mount, 1500);
    console.info('[ai-ref] 已加载 v' + (typeof GM_info !== 'undefined' ? GM_info.script.version : '?') + ' @ ' + location.href);

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开 / 关闭参考库', () => toggle());
        GM_registerMenuCommand('调试：输出各库首条原始数据', () => LIBS.forEach(([k]) => console.log('[ai-ref]', k, state.raw[k] && state.raw[k][0], state.items[k] && state.items[k][0])));
        GM_registerMenuCommand('调试：输出当前输入框信息', () => { const e = findInput(); console.log('[ai-ref] input', e, e && e.isContentEditable, e && e.outerHTML.slice(0, 600)); });
        GM_registerMenuCommand('诊断：复制输入框结构（反馈问题用）', () => {
            const e = findInput();
            if (!e) return alert('没找到输入框，请先点一下输入框再试');
            const d = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 4).join('.') : '') +
                ' [' + [...n.attributes].filter((a) => a.name !== 'class' && a.name !== 'id').map((a) => a.name + '=' + a.value.slice(0, 40)).join(' ') + ']';
            const chain = []; for (let n = e, i = 0; n && i < 7; n = n.parentElement, i++) chain.push(d(n));
            const fw = [e.closest('[data-slate-editor]') && 'slate', e.closest('[data-lexical-editor]') && 'lexical', e.closest('.ProseMirror') && 'prosemirror', e.closest('.ql-editor') && 'quill', Object.keys(e).some((k) => k.startsWith('__react')) && 'react'].filter(Boolean).join(',') || '未知';
            const report = ['host: ' + location.host, 'isContentEditable: ' + e.isContentEditable, 'framework: ' + fw,
                '祖先链(自身→外层):', ...chain, '输入框 outerHTML:', e.outerHTML.slice(0, 1500),
                '外层容器 outerHTML:', ((e.parentElement && e.parentElement.outerHTML) || '').slice(0, 2500)].join('\n');
            console.log('[ai-ref] 诊断\n' + report);
            try { GM_setClipboard(report); alert('已复制诊断信息到剪贴板，直接粘贴发给我即可'); } catch (_) { alert('请从控制台复制 [ai-ref] 诊断 输出'); }
        });
        GM_registerMenuCommand('诊断：复制附件控件结构（附件失败时用）', () => {
            const e = findInput();
            if (!e) return alert('没找到输入框，请先点一下输入框再试');
            const card = e.closest('[role="region"],[data-testid*="generator" i]') || composerOf(e);
            const short = (n, len) => n.outerHTML.slice(0, len);
            const inputs = deepAll('input[type="file"]').map((i) => short(i, 300) + '\n  父级: ' + (i.parentElement ? short(i.parentElement, 300) : ''));
            const buttons = [...card.querySelectorAll('button,[role="button"],label')].slice(0, 30).map((b) => short(b, 250));
            const adders = [...card.querySelectorAll('[class*="add" i],[class*="upload" i],[class*="plus" i],[class*="reference" i]')]
                .filter((n) => n.getBoundingClientRect().width > 0).slice(0, 25).map((n) => short(n, 250));
            const report = ['host: ' + location.host, 'href: ' + location.href,
            '诊断范围: ' + card.tagName.toLowerCase() + '.' + String(card.className).slice(0, 120),
            'input[type=file] 共 ' + inputs.length + ' 个:', ...inputs,
                '范围内按钮(前30):', ...buttons,
                '范围内 add/upload/plus/reference 元素(前25):', ...adders].join('\n');
            console.log('[ai-ref] 附件诊断\n' + report);
            try { GM_setClipboard(report); alert('已复制附件诊断信息到剪贴板'); } catch (_) { alert('请从控制台复制 [ai-ref] 附件诊断 输出'); }
        });
        GM_registerMenuCommand('清除数据缓存', () => {
            LIBS.forEach(([k]) => {
                GM_deleteValue('cache_' + k);
                GM_deleteValue('cache_v2_' + k);
            });
            alert('已清除所有数据缓存，刷新页面后重新拉取全量数据');
        });
    }
})();