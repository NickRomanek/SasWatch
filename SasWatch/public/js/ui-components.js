// Toast Notification System
const Toast = {
    container: null,

    getVisuals(type = 'info') {
        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠️',
            info: 'ℹ️',
            danger: '🗑️'
        };

        const colors = {
            success: { bg: 'var(--success)', light: 'var(--success-light)' },
            error: { bg: 'var(--danger)', light: 'var(--danger-light)' },
            warning: { bg: 'var(--warning)', light: 'var(--warning-light)' },
            info: { bg: 'var(--accent-primary)', light: 'var(--accent-light)' },
            danger: { bg: 'var(--danger)', light: 'var(--danger-light)' }
        };

        const key = colors[type] ? type : 'info';

        return {
            icon: icons[key] || 'ℹ️',
            colors: colors[key]
        };
    },

    sanitizeMessage(message) {
        return String(message ?? '').replace(/^([✓✗⚠️ℹ️🗑️\s]*)+/g, '').trim();
    },

    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 12px;
                max-width: 400px;
            `;
            document.body.appendChild(this.container);
        }
    },

    show(message, type = 'info', duration = 4000) {
        this.init();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const { icon, colors } = this.getVisuals(type);
        const color = colors;

        toast.style.padding = '16px 20px';
        toast.style.borderRadius = '8px';
        toast.style.display = 'flex';
        toast.style.alignItems = 'flex-start';
        toast.style.gap = '12px';
        toast.style.animation = 'slideIn 0.3s ease';
        toast.style.minWidth = '300px';
        toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        toast.style.borderLeft = `4px solid ${color.bg}`;

        // Theme-aware colors
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const backgroundColor = isDark
            ? 'var(--bg-card)'
            : (color.light || '#eef2ff');
        const textColor = isDark ? 'var(--text-primary)' : '#0f172a';
        const shadowColor = isDark ? '0 6px 16px rgba(15, 23, 42, 0.4)' : '0 10px 30px rgba(15, 23, 42, 0.18)';

        toast.style.background = backgroundColor;
        toast.style.color = textColor;
        toast.style.boxShadow = shadowColor;
        toast.style.border = isDark ? '1px solid rgba(148, 163, 184, 0.25)' : '1px solid rgba(148, 163, 184, 0.2)';

        const iconBackground = isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(148, 163, 184, 0.2)';
        const iconBorder = isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.28)';

        const sanitizedMessage = this.sanitizeMessage(message);

        toast.innerHTML = `
            <span style="
                flex-shrink: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 1.9rem;
                height: 1.9rem;
                font-size: 1.15rem;
                line-height: 1;
                border-radius: 9999px;
                border: 1px solid ${iconBorder};
                background: ${iconBackground};
                color: ${color.bg};
                margin-top: 2px;
            ">${icon}</span>
            <span style="
                flex: 1;
                font-size: 0.938rem;
                line-height: 1.5;
                margin-top: 2px;
            ">${sanitizedMessage}</span>
            <button onclick="this.parentElement.remove()" style="
                background: none;
                border: none;
                font-size: 1.1rem;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.2s;
                color: inherit;
                padding: 0;
                width: 1.75rem;
                height: 1.75rem;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-top: 0;
                align-self: flex-start;
            " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">×</button>
        `;

        this.container.appendChild(toast);

        // Auto remove
        if (duration > 0) {
            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        return toast;
    },

    confirm(message, options = {}) {
        this.init();

        const {
            type = 'warning',
            title = '',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            duration = 0
        } = options;

        return new Promise((resolve) => {
            const { icon, colors } = this.getVisuals(type);
            const color = colors;
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const backgroundColor = isDark
                ? 'var(--bg-card)'
                : (color.light || '#eef2ff');
            const textColor = isDark ? 'var(--text-primary)' : '#0f172a';
            const shadowColor = isDark ? '0 6px 16px rgba(15, 23, 42, 0.4)' : '0 10px 30px rgba(15, 23, 42, 0.18)';
            const iconBackground = isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(148, 163, 184, 0.2)';
            const iconBorder = isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.28)';
            const sanitizedMessage = this.sanitizeMessage(message);

            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.style.padding = '18px 22px 20px';
            toast.style.borderRadius = '12px';
            toast.style.display = 'flex';
            toast.style.flexDirection = 'column';
            toast.style.gap = '16px';
            toast.style.animation = 'slideIn 0.3s ease';
            toast.style.minWidth = '320px';
            toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            toast.style.borderLeft = `4px solid ${color.bg}`;
            toast.style.background = backgroundColor;
            toast.style.color = textColor;
            toast.style.boxShadow = shadowColor;
            toast.style.border = isDark ? '1px solid rgba(148, 163, 184, 0.25)' : '1px solid rgba(148, 163, 184, 0.2)';
            toast.setAttribute('role', 'alertdialog');
            toast.setAttribute('aria-live', 'assertive');

            toast.innerHTML = `
                <div style="display: flex; gap: 14px; align-items: flex-start;">
                    <span style="
                        flex-shrink: 0;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 2.15rem;
                        height: 2.15rem;
                        font-size: 1.25rem;
                        line-height: 1;
                        border-radius: 9999px;
                        border: 1px solid ${iconBorder};
                        background: ${iconBackground};
                        color: ${color.bg};
                        margin-top: 2px;
                    ">${icon}</span>
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
                        ${title ? `<strong style="font-size: 1rem;">${title}</strong>` : ''}
                        <span style="font-size: 0.95rem; line-height: 1.55;">${sanitizedMessage}</span>
                    </div>
                    <button type="button" data-action="close" style="
                        background: none;
                        border: none;
                        font-size: 1.1rem;
                        cursor: pointer;
                        opacity: 0.6;
                        transition: opacity 0.2s;
                        color: inherit;
                        padding: 0;
                        width: 1.75rem;
                        height: 1.75rem;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin-top: 0;
                    ">×</button>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" data-action="cancel" style="
                        padding: 10px 18px;
                        background: var(--bg-secondary);
                        color: var(--text-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.9rem;
                        font-weight: 500;
                        transition: background 0.2s, color 0.2s;
                    ">${cancelText}</button>
                    <button type="button" data-action="confirm" style="
                        padding: 10px 18px;
                        background: ${color.bg};
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.9rem;
                        font-weight: 600;
                        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.15);
                        transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
                    ">${confirmText}</button>
                </div>
            `;

            this.container.appendChild(toast);

            const confirmButton = toast.querySelector('[data-action="confirm"]');
            const cancelButton = toast.querySelector('[data-action="cancel"]');
            const closeButton = toast.querySelector('[data-action="close"]');

            let resolved = false;

            const cleanup = (result) => {
                if (resolved) return;
                resolved = true;
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => toast.remove(), 280);
                document.removeEventListener('keydown', handleKeydown);
                resolve(result);
            };

            const handleKeydown = (event) => {
                if (event.key === 'Escape') {
                    cleanup(false);
                } else if (event.key === 'Enter') {
                    cleanup(true);
                }
            };

            confirmButton.addEventListener('click', () => cleanup(true));
            cancelButton.addEventListener('click', () => cleanup(false));
            closeButton.addEventListener('click', () => cleanup(false));
            toast.addEventListener('mouseenter', () => {
                toast.style.boxShadow = '0 10px 28px rgba(15, 23, 42, 0.22)';
            });
            toast.addEventListener('mouseleave', () => {
                toast.style.boxShadow = shadowColor;
            });

            document.addEventListener('keydown', handleKeydown);

            setTimeout(() => {
                confirmButton.focus();
            }, 10);

            if (duration > 0) {
                setTimeout(() => cleanup(false), duration);
            }
        });
    },

    success(message, duration) {
        return this.show(message, 'success', duration);
    },

    error(message, duration) {
        return this.show(message, 'error', duration);
    },

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    },

    info(message, duration) {
        return this.show(message, 'info', duration);
    }
};

// Confirmation Modal System
const ConfirmModal = {
    show(options) {
        return new Promise((resolve) => {
            const {
                title = 'Confirm Action',
                message = 'Are you sure?',
                confirmText = 'Confirm',
                cancelText = 'Cancel',
                type = 'warning'
            } = options;

            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
                backdrop-filter: blur(4px);
            `;

            const modal = document.createElement('div');
            modal.style.cssText = `
                background: var(--bg-card);
                border-radius: 12px;
                padding: 32px;
                max-width: 440px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: slideUp 0.3s ease;
                border: 1px solid var(--border-color);
            `;

            const typeIcons = {
                warning: '⚠️',
                danger: '🗑️',
                info: 'ℹ️',
                success: '✓'
            };

            const typeColors = {
                warning: 'var(--warning)',
                danger: 'var(--danger)',
                info: 'var(--accent-primary)',
                success: 'var(--success)'
            };

            modal.innerHTML = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">${typeIcons[type] || '❓'}</div>
                    <h3 style="margin: 0 0 12px 0; color: var(--text-primary); font-size: 1.5rem;">${title}</h3>
                    <div style="margin: 0; color: var(--text-secondary); line-height: 1.5;">${message}</div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="modal-cancel" style="
                        padding: 12px 24px;
                        background: var(--bg-secondary);
                        color: var(--text-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.938rem;
                        font-weight: 500;
                        transition: all 0.2s;
                        min-width: 100px;
                    ">${cancelText}</button>
                    <button id="modal-confirm" style="
                        padding: 12px 24px;
                        background: ${typeColors[type] || 'var(--accent-primary)'};
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.938rem;
                        font-weight: 600;
                        transition: all 0.2s;
                        min-width: 100px;
                    ">${confirmText}</button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const cleanup = () => {
                overlay.style.animation = 'fadeOut 0.2s ease';
                setTimeout(() => overlay.remove(), 200);
            };

            modal.querySelector('#modal-confirm').onclick = () => {
                cleanup();
                resolve(true);
            };

            modal.querySelector('#modal-cancel').onclick = () => {
                cleanup();
                resolve(false);
            };

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(false);
                }
            };
        });
    }
};

// Loading Spinner for Buttons
function addButtonSpinner(button, originalText) {
    button.disabled = true;
    button.dataset.originalText = originalText || button.innerHTML;
    button.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 8px;">
            <span class="spinner"></span>
            Loading...
        </span>
    `;
}

function removeButtonSpinner(button) {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || button.innerHTML;
}

// Copy to Clipboard with Toast
async function copyToClipboard(text, successMessage = 'Copied to clipboard!') {
    try {
        await navigator.clipboard.writeText(text);
        Toast.success(successMessage);
        return true;
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            document.execCommand('copy');
            Toast.success(successMessage);
            return true;
        } catch (e) {
            Toast.error('Failed to copy');
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
}

// Add CSS animations
if (!document.getElementById('ui-components-styles')) {
    const style = document.createElement('style');
    style.id = 'ui-components-styles';
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }

        @keyframes slideUp {
            from {
                transform: translateY(20px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .spinner {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            display: inline-block;
        }

        .skeleton {
            background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
            background-size: 200% 100%;
            animation: loading 1.5s ease-in-out infinite;
            border-radius: 4px;
        }

        @keyframes loading {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        .skeleton-text {
            height: 16px;
            margin-bottom: 8px;
        }

        .skeleton-title {
            height: 24px;
            width: 60%;
            margin-bottom: 16px;
        }

        .skeleton-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
        }
    `;
    document.head.appendChild(style);
}
