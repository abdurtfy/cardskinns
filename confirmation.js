const confirmationPanel = document.querySelector("#confirmationPanel");
const params = new URLSearchParams(window.location.search);
const orderId = params.get("order");
const token = params.get("token");

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN")}`;
}

async function loadConfirmation() {
  if (!orderId || !token) {
    confirmationPanel.innerHTML = `<p class="status-line">Missing or invalid order link.</p>`;
    return;
  }

  const response = await fetch(`/api/order/confirmation?id=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`);
  const data = await response.json();
  if (!response.ok) {
    confirmationPanel.innerHTML = `<p class="status-line">${data.error || "Order not found"}</p>`;
    return;
  }

  const order = data.order;
  confirmationPanel.innerHTML = `
    <div class="confirmation-head">
      <div>
        <p class="eyebrow">Thank you</p>
        <h2>${order.id}</h2>
      </div>
      <span class="status-pill">${order.status}</span>
    </div>
    <div class="admin-grid">
      <div>
        <h3>Payment</h3>
        <p>${order.payment_status}</p>
      </div>
      <div>
        <h3>Shipping</h3>
        <p>${order.shipping_status}</p>
        <p>${order.shiprocket_order_id || "Shipping order pending"}</p>
      </div>
      <div>
        <h3>Total</h3>
        <p>${formatCurrency(order.total)}</p>
      </div>
      <div>
        <h3>Email</h3>
        <p>${order.email_status || "pending"}</p>
      </div>
    </div>
    <div class="admin-items">
      ${order.lines.map((item) => `<span>${item.name} x ${item.quantity}</span>`).join("")}
    </div>
    <p class="muted">We will send confirmation and shipping follow-up emails to the email used at checkout.</p>
    <a class="primary-action" href="./index.html">Continue shopping</a>
  `;
}

loadConfirmation();
