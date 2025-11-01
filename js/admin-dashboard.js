// Admin Dashboard JavaScript
class AdminDashboard {
    constructor() {
        this.sidebar = document.getElementById('sidebar');
        this.collapseBtn = document.getElementById('collapseBtn');
        this.collapseIcon = document.getElementById('collapseIcon');
        this.logoText = document.getElementById('logoText');
        this.navItems = document.querySelectorAll('.nav-item');
        this.contentPlaceholder = document.getElementById('contentPlaceholder');
        this.activeAppName = document.getElementById('activeAppName');
        
        this.isCollapsed = false;
        this.activeApp = 'sales-command';
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.loadAppConfig();
        this.setActiveApp(this.activeApp);
    }
    
    setupEventListeners() {
        // Collapse button
        this.collapseBtn.addEventListener('click', () => {
            this.toggleSidebar();
        });
        
        // Navigation items
        this.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const appKey = item.dataset.app;
                this.setActiveApp(appKey);
            });
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key) {
                    case 'b':
                        e.preventDefault();
                        this.toggleSidebar();
                        break;
                }
            }
        });
        
        // Responsive behavior
        window.addEventListener('resize', () => {
            this.handleResize();
        });
        
        this.handleResize();
    }
    
    toggleSidebar() {
        this.isCollapsed = !this.isCollapsed;
        this.sidebar.classList.toggle('collapsed', this.isCollapsed);
        
        // Update collapse icon
        this.collapseIcon.style.transform = this.isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
        
        // Store preference
        localStorage.setItem('admin-sidebar-collapsed', this.isCollapsed);
        
        // Announce to screen readers
        this.announceToScreenReader(
            this.isCollapsed ? 'Sidebar collapsed' : 'Sidebar expanded'
        );
    }
    
    setActiveApp(appKey) {
        // Update active nav item
        this.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.app === appKey);
        });
        
        this.activeApp = appKey;
        
        // Update content placeholder
        const appName = this.getAppDisplayName(appKey);
        this.activeAppName.textContent = appName;
        
        // Store active app
        localStorage.setItem('admin-active-app', appKey);
        
        // Load app content (placeholder for now)
        this.loadAppContent(appKey);
        
        // Announce to screen readers
        this.announceToScreenReader(`Switched to ${appName}`);
    }
    
    getAppDisplayName(appKey) {
        const appNames = {
            'sales-command': 'Sales Command',
            'pos-hub': 'POS Hub',
            'people-payroll': 'People & Payroll',
            'team-scheduler': 'Team Scheduler',
            'inventory-flow': 'Inventory Flow',
            'expense-ledger': 'Expense Ledger'
        };
        return appNames[appKey] || appKey;
    }
    
    loadAppContent(appKey) {
        // This is where you would load the actual app content
        // For now, we'll just update the placeholder
        
        const appConfig = this.getAppConfig(appKey);
        
        // Add loading state
        this.contentPlaceholder.classList.add('loading');
        
        // Simulate loading delay
        setTimeout(() => {
            this.contentPlaceholder.classList.remove('loading');
            this.updatePlaceholderContent(appConfig);
        }, 300);
    }
    
    getAppConfig(appKey) {
        const configs = {
            'sales-command': {
                title: 'Sales Command',
                description: 'Monitor sales performance, analytics, and reporting',
                icon: '📊',
                color: '#3b82f6'
            },
            'pos-hub': {
                title: 'POS Hub',
                description: 'Point of sale management and transaction monitoring',
                icon: '🖥️',
                color: '#8b5cf6'
            },
            'people-payroll': {
                title: 'People & Payroll',
                description: 'Employee management, payroll processing, and HR functions',
                icon: '👥',
                color: '#10b981'
            },
            'team-scheduler': {
                title: 'Team Scheduler',
                description: 'Staff scheduling, shift management, and time tracking',
                icon: '📅',
                color: '#f59e0b'
            },
            'inventory-flow': {
                title: 'Inventory Flow',
                description: 'Stock management, supplier tracking, and inventory analytics',
                icon: '📦',
                color: '#ef4444'
            },
            'expense-ledger': {
                title: 'Expense Ledger',
                description: 'Expense tracking, receipt management, and financial reporting',
                icon: '🧾',
                color: '#06b6d4'
            }
        };
        
        return configs[appKey] || {
            title: 'Unknown App',
            description: 'Application not found',
            icon: '❓',
            color: '#6b7280'
        };
    }
    
    updatePlaceholderContent(config) {
        // Simple update - just change the text
        this.activeAppName.textContent = config.title;
    }
    
    loadAppConfig() {
        // Load saved preferences
        const savedCollapsed = localStorage.getItem('admin-sidebar-collapsed');
        const savedActiveApp = localStorage.getItem('admin-active-app');
        
        if (savedCollapsed === 'true') {
            this.toggleSidebar();
        }
        
        if (savedActiveApp) {
            this.activeApp = savedActiveApp;
        }
    }
    
    handleResize() {
        // Auto-collapse on mobile
        if (window.innerWidth <= 768) {
            if (!this.isCollapsed) {
                this.toggleSidebar();
            }
        }
    }
    
    announceToScreenReader(message) {
        // Create a temporary element for screen reader announcements
        const announcement = document.createElement('div');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.style.position = 'absolute';
        announcement.style.left = '-10000px';
        announcement.style.width = '1px';
        announcement.style.height = '1px';
        announcement.style.overflow = 'hidden';
        
        document.body.appendChild(announcement);
        announcement.textContent = message;
        
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }
    
    // Public methods for external integration
    openApp(appKey) {
        this.setActiveApp(appKey);
    }
    
    toggleSidebarState() {
        this.toggleSidebar();
    }
    
    getActiveApp() {
        return this.activeApp;
    }
    
    isSidebarCollapsed() {
        return this.isCollapsed;
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminDashboard = new AdminDashboard();
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdminDashboard;
}
