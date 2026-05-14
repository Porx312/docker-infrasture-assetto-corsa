const API_BASE = '/admin';

let currentTab = 'cars';
let allItems = { cars: [], tracks: [], weather: [] };

async function checkAuth() {
    try {
        const res = await fetch(`${API_BASE}/check`, { credentials: 'include' });
        const data = await res.json();
        if (!data.authenticated) {
            window.location.href = '/admin/login.html';
        }
        return data.authenticated;
    } catch {
        window.location.href = '/admin/login.html';
        return false;
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
    } finally {
        window.location.href = '/admin/login.html';
    }
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${tab}Section`).classList.add('active');
    loadContent(tab);
}

function showAlert(message, type = 'success') {
    const container = document.getElementById('alertContainer');
    container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    setTimeout(() => container.innerHTML = '', 5000);
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

function filterItems(type) {
    const searchInput = document.getElementById(`${type}Search`);
    const searchTerm = searchInput.value.toLowerCase();
    const filteredSpan = document.getElementById(`${type}Filtered`);
    const items = allItems[type] || [];
    
    const filtered = items.filter(item => item.name.toLowerCase().includes(searchTerm));
    const countLabel = searchTerm ? `${filtered.length} of ${items.length}` : `${items.length} items`;
    filteredSpan.textContent = countLabel;
    
    renderItems(filtered, type);
}

function renderItems(items, type) {
    const container = document.getElementById(`${type}List`);
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="empty">No items found</div>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="item-card">
            <div class="item-info">
                <div class="item-name">${escapeHtml(item.name)}</div>
                <div class="item-meta">
                    ${item.isDirectory ? 'Folder' : formatSize(item.size)} | ${formatDate(item.modified)}
                </div>
            </div>
            <button class="delete-btn" onclick="deleteItem('${type}', '${escapeHtml(item.name)}')">Delete</button>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function loadContent(type) {
    const container = document.getElementById(`${type}List`);

    try {
        const res = await fetch(`${API_BASE}/content/${type}`, { credentials: 'include' });
        const data = await res.json();

        if (data.ok) {
            allItems[type] = data.items;
            document.getElementById(`${type}Filtered`).textContent = `${data.items.length} items`;
            document.getElementById(`${type}Search`).value = '';
            renderItems(data.items, type);
        } else {
            container.innerHTML = `<div class="empty">Error loading content: ${data.message}</div>`;
        }
    } catch (err) {
        container.innerHTML = `<div class="empty">Connection error</div>`;
    }
}

async function deleteItem(type, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
        const res = await fetch(`${API_BASE}/content/${type}/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await res.json();

        if (data.ok) {
            showAlert(`Deleted ${name}`);
            loadContent(type);
        } else {
            showAlert(data.message || 'Delete failed', 'error');
        }
    } catch {
        showAlert('Connection error', 'error');
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e, type) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
        confirmUpload(files, type);
    }
}

function handleFileSelect(e, type) {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        confirmUpload(files, type);
    }
    e.target.value = '';
}

function confirmUpload(files, type) {
    const fileNames = files.map(f => `- ${f.name}`).join('\n');
    const fileCount = files.length;
    const confirmed = confirm(`Upload ${fileCount} file(s)?\n\n${fileCount === 1 ? files[0].name : fileNames}`);
    if (confirmed) {
        uploadFiles(files, type);
    }
}

function showUploadingOverlay(message) {
    const overlay = document.getElementById('uploadingOverlay');
    document.getElementById('uploadingStatus').textContent = message;
    overlay.classList.add('show');
}

function hideUploadingOverlay() {
    const overlay = document.getElementById('uploadingOverlay');
    overlay.classList.remove('show');
}

async function uploadFiles(files, type) {
    showUploadingOverlay(`Uploading ${files.length} file(s)...`);

    const progressBar = document.getElementById(`${type}Progress`);
    const progressFill = document.getElementById(`${type}ProgressFill`);
    progressBar.classList.add('show');
    progressFill.style.width = '0%';

    let successCount = 0;
    let errorMessages = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_BASE}/upload/${type}`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            const data = await res.json();

            if (data.ok) {
                successCount++;
                if (data.extracted && data.extracted.length > 1) {
                    showAlert(`Extracted ${data.extracted.length} files from ${file.name}`);
                }
            } else {
                errorMessages.push(`${file.name}: ${data.message}`);
            }
        } catch (err) {
            errorMessages.push(`${file.name}: Connection error`);
        }

        progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
    }

    setTimeout(() => {
        progressBar.classList.remove('show');
        hideUploadingOverlay();
        
        if (successCount > 0) {
            if (errorMessages.length > 0) {
                showAlert(`Uploaded ${successCount} file(s), ${errorMessages.length} errors`, 'error');
            } else {
                showAlert(`Uploaded ${successCount} file(s) successfully`);
            }
        } else if (errorMessages.length > 0) {
            showAlert(errorMessages.join('\n'), 'error');
        }
        
        loadContent(type);
    }, 500);
}

document.addEventListener('DOMContentLoaded', async () => {
    const authenticated = await checkAuth();
    if (authenticated) {
        loadContent('cars');
    }
});