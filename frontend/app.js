/**
 * Paste-Any Frontend
 * 快速文本传输前端逻辑 - 支持图片粘贴
 */

let API_BASE = '/paste-api';

var __lbDone = false;
async function ensureLB() {
    if (__lbDone) return;
    if (window.__lbReady) {
        var best = await window.__lbReady;
        if (best) API_BASE = best + '/paste-api';
        __lbDone = true;
        console.log('[LB] API_BASE =', API_BASE);
    }
}

// DOM 元素
const contentEl = document.getElementById('content');
const codeInputEl = document.getElementById('codeInput');
const storeBtnEl = document.getElementById('storeBtn');
const fetchBtnEl = document.getElementById('fetchBtn');
const statusEl = document.getElementById('status');

/**
 * 带重试的 fetch。
 * ngrok 免费域名的边缘节点会随机丢连接（实测公网成功率约 77%，
 * 失败表现为 "Error in the HTTP2 framing layer" / "Connection reset by peer"，
 * 且这些请求根本没有到达 nginx）。
 * 重试 3 次 + 退避后成功率恢复到 100%。
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
    const BACKOFF_MS = [0, 400, 900];
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
        if (BACKOFF_MS[attempt]) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        }
        try {
            const response = await fetch(url, options);
            // 5xx 也重试：后端抖动时值得再试一次
            if (response.status >= 500 && attempt < retries - 1) {
                lastError = new Error(`HTTP ${response.status}`);
                continue;
            }
            return response;
        } catch (error) {
            lastError = error;
            console.warn(`[retry] attempt ${attempt + 1}/${retries} failed:`, error.message);
        }
    }
    throw lastError || new Error('请求失败');
}

// URL 检测 & 展示
const URL_RE = /(?:https?:\/\/)[^\s<>"'`]+/gi;
const urlBarEl = document.getElementById('urlBar');

function showUrlBar(text) {
    URL_RE.lastIndex = 0;
    const urls = [...new Set((text.match(URL_RE) || []))];
    if (urls.length === 0) {
        urlBarEl.classList.remove('show');
        urlBarEl.innerHTML = '';
        return;
    }
    urlBarEl.innerHTML = '🔗 ' + urls.map(u =>
        `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`
    ).join(' ');
    urlBarEl.classList.add('show');
}

// 状态管理
let isLoading = false;
let statusTimeout = null;

// 清除状态定时器
function clearStatusTimeout() {
    if (statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }
}

// 设置状态消息
function setStatus(html, type) {
    clearStatusTimeout();
    statusEl.innerHTML = html;
    statusEl.className = `status show ${type}`;
}

// 显示状态消息（自动隐藏）
function showStatus(message, type = 'info') {
    if (type === 'error') {
        setStatus(`❌ ${message}`, 'error');
    } else {
        setStatus(message, type);
        statusTimeout = setTimeout(() => {
            statusEl.classList.remove('show');
        }, 3000);
    }
}

// 显示成功消息（带提取码，不自动隐藏）
function showSuccess(code, expiresIn = 180) {
    const minutes = Math.floor(expiresIn / 60);
    const seconds = expiresIn % 60;
    const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;

    setStatus(`
        <div>✅ 存入成功！</div>
        <div class="code">${code}</div>
        <div>${timeStr}内有效，请尽快使用</div>
    `, 'success');
}

// 显示错误消息
function showError(message) {
    setStatus(`❌ ${message}`, 'error');
}

// 图片转 base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 压缩图片
async function compressImage(base64, maxSize = 500 * 1024) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            let width = img.width;
            let height = img.height;
            const maxDim = 1920;

            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round(height * maxDim / width);
                    width = maxDim;
                } else {
                    width = Math.round(width * maxDim / height);
                    height = maxDim;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            let quality = 0.8;
            let result = canvas.toDataURL('image/jpeg', quality);

            while (result.length > maxSize && quality > 0.5) {
                quality -= 0.1;
                result = canvas.toDataURL('image/jpeg', quality);
            }

            resolve(result);
        };
        img.src = base64;
    });
}

// 处理粘贴事件
contentEl.addEventListener('paste', async function(e) {
    let imageFile = null;

    const clipboardData = e.clipboardData || window.clipboardData;
    if (clipboardData) {
        const items = clipboardData.items || [];
        const files = clipboardData.files || [];

        // 1. 检查 files
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileType = file.type || '';
            const fileName = file.name || '';

            if (fileType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName)) {
                imageFile = file;
                break;
            }
        }

        // 2. 检查 items
        if (!imageFile) {
            for (let item of items) {
                if (item && item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) {
                        const fileType = file.type || '';
                        const fileName = file.name || '';
                        if (fileType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName)) {
                            imageFile = file;
                            break;
                        }
                    }
                }
            }
        }
    }

    if (imageFile) {
        e.preventDefault();

        if (imageFile.size > 5 * 1024 * 1024) {
            showError('图片太大，请压缩到 5MB 以下');
            return;
        }

        showStatus('处理图片中...', 'info');

        try {
            const base64 = await fileToBase64(imageFile);
            const compressed = await compressImage(base64);

            const img = document.createElement('img');
            img.src = compressed;
            img.className = 'pasted-image';
            img.contentEditable = 'false';

            contentEl.appendChild(img);

            const range = document.createRange();
            range.selectNodeContents(contentEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            showStatus('✅ 图片已插入', 'success');
        } catch (err) {
            console.error('Image paste error:', err);
            showError('图片处理失败');
        }
    }
});

// 存入文本
async function storeContent() {
    await ensureLB();
    const textContent = contentEl.innerText.trim();
    const hasText = textContent.length > 0;
    const hasImages = contentEl.querySelector('img') !== null;

    if (!hasText && !hasImages) {
        showError('请输入内容或粘贴图片');
        return;
    }

    if (isLoading) return;

    isLoading = true;
    storeBtnEl.disabled = true;
    storeBtnEl.textContent = '存入中...';

    try {
        const content = contentEl.innerHTML;

        const response = await fetchWithRetry(`${API_BASE}/pastes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ content })
        });

        const data = await response.json();

        if (response.ok) {
            showSuccess(data.code, 180);
            showUrlBar(contentEl.innerText);
            contentEl.innerHTML = '';
        } else {
            showError(data.detail || '存入失败');
        }
    } catch (error) {
        console.error('Store error:', error);
        showError('网络错误，请稍后重试');
    } finally {
        isLoading = false;
        storeBtnEl.disabled = false;
        storeBtnEl.textContent = '存入';
    }
}

// 取出文本
async function fetchContent() {
    await ensureLB();
    const code = codeInputEl.value.trim().toUpperCase();

    if (!code || code.length !== 4) {
        showError('请输入4位提取码');
        return;
    }

    if (isLoading) return;

    isLoading = true;
    fetchBtnEl.disabled = true;
    fetchBtnEl.textContent = '取出中...';

    try {
        const response = await fetchWithRetry(`${API_BASE}/pastes/${code}`, {
            headers: {
                'ngrok-skip-browser-warning': 'true'
            }
        });

        const data = await response.json();

        if (response.ok) {
            contentEl.innerHTML = data.content;
            showUrlBar(contentEl.innerText);
            showStatus('✅ 取出成功！', 'success');
            codeInputEl.value = '';
            fetchBtnEl.disabled = true;
        } else {
            showError(data.detail || '提取码不存在或已过期');
        }
    } catch (error) {
        console.error('Fetch error:', error);
        showError('网络错误，请稍后重试');
    } finally {
        isLoading = false;
        fetchBtnEl.disabled = !codeInputEl.value.trim();
        fetchBtnEl.textContent = '取出';
    }
}

// 事件监听
storeBtnEl.addEventListener('click', storeContent);
fetchBtnEl.addEventListener('click', fetchContent);

// 提取码输入监听
codeInputEl.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    fetchBtnEl.disabled = !value || value.length !== 4;
});

// Ctrl+Enter 存入
contentEl.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        storeContent();
    }
});

// Enter 取出
codeInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        fetchContent();
    }
});

// 图片交互功能
contentEl.addEventListener('click', function(e) {
    if (e.target.tagName === 'IMG') {
        selectImage(e.target);
    }
});

// 双击图片放大
contentEl.addEventListener('dblclick', function(e) {
    if (e.target.tagName === 'IMG') {
        e.preventDefault();
        showImageModal(e.target.src);
    }
});

let selectedImageSrc = null;

function selectImage(img) {
    contentEl.querySelectorAll('img').forEach(i => {
        i.style.outline = 'none';
        i.style.boxShadow = 'none';
        delete i.dataset.selected;
    });

    img.style.outline = '2px solid #00d9ff';
    img.style.boxShadow = '0 0 15px rgba(0, 217, 255, 0.5)';
    img.dataset.selected = 'true';
    selectedImageSrc = img.src;

    // 显示操作提示
    statusEl.innerHTML = `
        <span>✅ 图片已选中</span>
        <button id="btn-copy-b64" class="btn-image-action">📋 复制Base64</button>
        <span class="image-hint">Delete 删除 · 双击放大 · ESC 取消</span>
    `;
    statusEl.className = 'status show success';

    // 直接绑定按钮事件
    const copyBtn = document.getElementById('btn-copy-b64');
    if (copyBtn) {
        copyBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (selectedImageSrc) {
                copyBase64(selectedImageSrc);
            }
        });
    }

    document.addEventListener('keydown', handleImageKeydown);
}

function copyBase64(src) {
    // 从 src 中提取 base64 数据
    const base64 = src.split(',')[1];
    if (base64) {
        navigator.clipboard.writeText(src).then(() => {
            showStatus('✅ Base64 已复制到剪贴板', 'success');
        }).catch(() => {
            showError('复制失败');
        });
    } else {
        showError('无法获取 Base64');
    }
}

function handleImageKeydown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedImg = contentEl.querySelector('img[data-selected="true"]');
        if (selectedImg) {
            e.preventDefault();
            e.stopPropagation();
            selectedImg.remove();
            showStatus('✅ 图片已删除', 'success');
            document.removeEventListener('keydown', handleImageKeydown);
        }
    }
    if (e.key === 'Escape') {
        contentEl.querySelectorAll('img').forEach(i => {
            i.style.outline = 'none';
            i.style.boxShadow = 'none';
            delete i.dataset.selected;
        });
        document.removeEventListener('keydown', handleImageKeydown);
        statusEl.classList.remove('show');
    }
}

function showImageModal(src) {
    const existing = document.getElementById('image-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'image-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        cursor: pointer;
    `;

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;cursor:zoom-out;';

    const hint = document.createElement('div');
    hint.textContent = '点击任意位置关闭';
    hint.style.cssText = 'position:absolute;bottom:30px;color:#888;font-size:14px;';

    modal.appendChild(img);
    modal.appendChild(hint);
    document.body.appendChild(modal);

    modal.addEventListener('click', () => modal.remove());

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

console.log('📋 Paste-Any Frontend Loaded');
