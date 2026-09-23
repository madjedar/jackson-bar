// =========================================================================
// JACKSON BAR — ADMIN DASHBOARD LOGIC
// =========================================================================

const STORAGE_KEY = 'jb_course_orders';

// Shared Helper: Get all orders
function getOrders() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Error reading orders from localStorage', e);
        return [];
    }
}

// Shared Helper: Save all orders
function saveOrders(orders) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
        window.dispatchEvent(new Event('orders_updated'));
    } catch (e) {
        console.error('Error saving orders to localStorage', e);
    }
}

// Show temporary toast message
function showToast(message) {
    const toast = document.getElementById('admin-toast');
    const toastMsg = document.getElementById('toast-message');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2800);
}

// Format Date for display
function formatDate(isoString) {
    if (!isoString) return 'Recent';
    try {
        const d = new Date(isoString);
        return d.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return isoString;
    }
}

// Format Phone for WhatsApp Link (supports Algerian local formats: 05, 06, 07)
function formatWhatsAppUrl(rawPhone, studentName, courseName) {
    let clean = (rawPhone || '').replace(/\D/g, '');
    if (clean.startsWith('0') && (clean.length === 10)) {
        clean = '213' + clean.substring(1);
    }
    const message = encodeURIComponent(`Hello ${studentName}! This is Jackson Bar Academy regarding your enrollment in the ${courseName} course.`);
    return `https://wa.me/${clean}?text=${message}`;
}

// Render Dashboard
function renderDashboard() {
    const orders = getOrders();
    const searchInput = document.getElementById('order-search');
    const courseFilter = document.getElementById('course-filter');
    const statusFilter = document.getElementById('status-filter');
    const container = document.getElementById('orders-container');
    const emptyState = document.getElementById('orders-empty');

    if (!container) return;

    // Filter values
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const selectedCourse = courseFilter ? courseFilter.value : 'ALL';
    const selectedStatus = statusFilter ? statusFilter.value : 'ALL';

    // Calculate metrics based on ALL orders
    const totalOrders = orders.length;
    let pendingCount = 0;
    let confirmedCount = 0;
    let totalRevenue = 0;

    orders.forEach(o => {
        if (o.status === 'Pending') pendingCount++;
        if (o.status === 'Confirmed' || o.status === 'Completed') confirmedCount++;

        // Parse price (e.g. 15,000 DZD -> 15000)
        const numPrice = parseInt(String(o.price || '0').replace(/\D/g, ''), 10);
        if (!isNaN(numPrice)) totalRevenue += numPrice;
    });

    // Update Metric DOM elements
    const elTotal = document.getElementById('metric-total-orders');
    const elPending = document.getElementById('metric-pending-orders');
    const elConfirmed = document.getElementById('metric-confirmed-orders');
    const elRevenue = document.getElementById('metric-total-revenue');

    if (elTotal) elTotal.textContent = totalOrders;
    if (elPending) elPending.textContent = pendingCount;
    if (elConfirmed) elConfirmed.textContent = confirmedCount;
    if (elRevenue) elRevenue.textContent = totalRevenue.toLocaleString() + ' DZD';

    // Apply active filters for rendering the list
    const filteredOrders = orders.filter(order => {
        // Search query check
        const matchName = (order.name || '').toLowerCase().includes(query);
        const matchPhone = (order.phone || '').toLowerCase().includes(query);
        const matchId = (order.id || '').toLowerCase().includes(query);
        const matchesSearch = matchName || matchPhone || matchId;

        // Course filter check
        const matchesCourse = selectedCourse === 'ALL' || order.course === selectedCourse;

        // Status filter check
        const matchesStatus = selectedStatus === 'ALL' || order.status === selectedStatus;

        return matchesSearch && matchesCourse && matchesStatus;
    });

    // Handle Empty State
    if (orders.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'flex';
        return;
    } else {
        if (emptyState) emptyState.style.display = 'none';
    }

    if (filteredOrders.length === 0) {
        container.innerHTML = `
            <div class="no-filter-match">
                <i class="fas fa-search"></i>
                <p>No orders match the current search & filter criteria.</p>
            </div>
        `;
        return;
    }

    // Render Order Cards / Table Rows
    container.innerHTML = filteredOrders.map(order => {
        const waUrl = formatWhatsAppUrl(order.phone, order.name, order.course);
        const telUrl = `tel:${(order.phone || '').replace(/\s+/g, '')}`;

        const statusClass = (order.status || 'Pending').toLowerCase();
        const courseIcon = order.course === 'Classic Bar'
            ? '<i class="fas fa-cocktail icon-bronze"></i>'
            : (order.course === 'Extra Barman'
                ? '<i class="fas fa-wine-glass-alt icon-silver"></i>'
                : '<i class="fas fa-crown icon-gold"></i>');

        return `
            <div class="order-row-card" data-order-id="${order.id}">
                <!-- Left: Order Info & Student Details -->
                <div class="order-main-info">
                    <div class="order-id-badge">
                        <span class="order-tag">${order.id || '#JB-0000'}</span>
                        <span class="order-date"><i class="far fa-calendar-alt"></i> ${formatDate(order.timestamp)}</span>
                    </div>

                    <div class="student-details">
                        <div class="student-name-row">
                            <i class="fas fa-user-circle student-avatar"></i>
                            <h3 class="student-name">${escapeHtml(order.name || 'Anonymous')}</h3>
                        </div>
                        <div class="student-contact-row">
                            <i class="fas fa-phone-alt"></i>
                            <span class="student-phone">${escapeHtml(order.phone || 'No phone')}</span>
                        </div>
                    </div>
                </div>

                <!-- Center: Course & Price Details -->
                <div class="order-course-info">
                    <div class="course-pill">
                        ${courseIcon}
                        <span>${escapeHtml(order.course || 'Course')}</span>
                    </div>
                    <div class="order-price-tag">
                        <strong>${escapeHtml(order.price || '-- DZD')}</strong>
                    </div>
                </div>

                <!-- Right: Status Dropdown & Fast Actions (Call, WhatsApp, Delete) -->
                <div class="order-actions-col">
                    <div class="status-select-wrapper">
                        <select class="status-dropdown status-${statusClass}" onchange="changeOrderStatus('${order.id}', this.value)">
                            <option value="Pending" ${order.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                            <option value="Confirmed" ${order.status === 'Confirmed' ? 'selected' : ''}>✅ Confirmed</option>
                            <option value="Completed" ${order.status === 'Completed' ? 'selected' : ''}>🎓 Completed</option>
                            <option value="Cancelled" ${order.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
                        </select>
                    </div>

                    <div class="quick-contact-btns">
                        <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="contact-btn wa-btn" title="Chat on WhatsApp">
                            <i class="fab fa-whatsapp"></i> WhatsApp
                        </a>
                        <a href="${telUrl}" class="contact-btn tel-btn" title="Call student directly">
                            <i class="fas fa-phone"></i> Call
                        </a>
                        <button onclick="deleteSingleOrder('${order.id}')" class="contact-btn del-btn" title="Delete this order">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Change Order Status
window.changeOrderStatus = function(orderId, newStatus) {
    const orders = getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
        orders[idx].status = newStatus;
        saveOrders(orders);
        renderDashboard();
        showToast(`Order ${orderId} status set to ${newStatus}`);
    }
};

// Delete Order
window.deleteSingleOrder = function(orderId) {
    if (!confirm(`Are you sure you want to delete order ${orderId}?`)) return;
    let orders = getOrders();
    orders = orders.filter(o => o.id !== orderId);
    saveOrders(orders);
    renderDashboard();
    showToast(`Order ${orderId} deleted.`);
};

// Add Sample Test Order
function addSampleOrder() {
    const sampleNames = [
        'Mohamed Amine', 'Karim Haddad', 'Sofiane Belkacem', 
        'Amel Zerrouki', 'Yacine Mansouri', 'Lina Bouzid'
    ];
    const sampleCourses = [
        { course: 'Classic Bar', price: '15,000 DZD' },
        { course: 'Extra Barman', price: '20,000 DZD' },
        { course: 'Golden Barman', price: '30,000 DZD' }
    ];
    const samplePhones = [
        '0550 12 34 56', '0661 78 90 12', '0770 45 67 89', '0541 33 22 11'
    ];

    const randomName = sampleNames[Math.floor(Math.random() * sampleNames.length)];
    const randomCourse = sampleCourses[Math.floor(Math.random() * sampleCourses.length)];
    const randomPhone = samplePhones[Math.floor(Math.random() * samplePhones.length)];

    const newOrder = {
        id: '#JB-' + Math.floor(1000 + Math.random() * 9000),
        name: randomName,
        phone: randomPhone,
        course: randomCourse.course,
        price: randomCourse.price,
        status: 'Pending',
        timestamp: new Date().toISOString()
    };

    const orders = getOrders();
    orders.unshift(newOrder);
    saveOrders(orders);
    renderDashboard();
    showToast(`Test order ${newOrder.id} created for ${newOrder.name}!`);
}

// Setup Event Listeners on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    // Initial Render
    renderDashboard();

    // Search input
    const searchInput = document.getElementById('order-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderDashboard());
    }

    // Filter selectors
    const courseFilter = document.getElementById('course-filter');
    if (courseFilter) {
        courseFilter.addEventListener('change', () => renderDashboard());
    }

    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', () => renderDashboard());
    }

    // Refresh Button
    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            renderDashboard();
            showToast('Orders list refreshed.');
        });
    }

    // Sample Order Buttons
    const btnSample = document.getElementById('btn-create-sample');
    if (btnSample) {
        btnSample.addEventListener('click', addSampleOrder);
    }
    const btnEmptySample = document.getElementById('btn-empty-sample');
    if (btnEmptySample) {
        btnEmptySample.addEventListener('click', addSampleOrder);
    }

    // Clear All Button
    const btnClearAll = document.getElementById('btn-clear-all');
    if (btnClearAll) {
        btnClearAll.addEventListener('click', () => {
            const orders = getOrders();
            if (orders.length === 0) {
                showToast('No orders to clear.');
                return;
            }
            if (confirm('Are you sure you want to delete ALL orders? This cannot be undone.')) {
                saveOrders([]);
                renderDashboard();
                showToast('All orders cleared.');
            }
        });
    }

    // Cross-tab real-time sync: when user registers on index.html in another tab
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
            renderDashboard();
            showToast('New order received in real-time!');
        }
    });

    window.addEventListener('orders_updated', () => {
        renderDashboard();
    });
});
