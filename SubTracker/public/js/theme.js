// Global theme & sidebar controller used across dashboard pages
(function () {
    function applyTheme(theme) {
        const html = document.documentElement;
        html.setAttribute('data-theme', theme);

        const icon = document.getElementById('theme-icon');
        if (icon) {
            icon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }

    function getStoredTheme() {
        return localStorage.getItem('theme') || 'dark';
    }

    function storeTheme(theme) {
        localStorage.setItem('theme', theme);
    }

    function applySidebarState() {
        const sidebar = document.getElementById('sidebar');
        const toggleIcon = document.getElementById('sidebar-toggle-icon');
        const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';

        if (!sidebar) {
            return;
        }

        if (collapsed) {
            sidebar.classList.add('collapsed');
            if (toggleIcon) {
                toggleIcon.textContent = '▶';
            }
        } else {
            sidebar.classList.remove('collapsed');
            if (toggleIcon) {
                toggleIcon.textContent = '◀';
            }
        }
    }

    function setSidebarCollapsed(isCollapsed) {
        localStorage.setItem('sidebarCollapsed', isCollapsed);
    }

    window.toggleTheme = function toggleTheme() {
        const current = getStoredTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        storeTheme(next);
        applyTheme(next);
    };

    window.toggleSidebar = function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const icon = document.getElementById('sidebar-toggle-icon');

        if (!sidebar) {
            return;
        }

        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        setSidebarCollapsed(isCollapsed);

        if (icon) {
            icon.textContent = isCollapsed ? '▶' : '◀';
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(getStoredTheme());
        applySidebarState();
    });
})();

