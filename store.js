const products = [
  {
    id: "noir-neon",
    name: "Noir Neon",
    category: "Credit",
    price: 99,
    finish: "Matte vinyl",
    bg: "linear-gradient(135deg, #08090f, #ff3c8a 48%, #cbff38)",
  },
  {
    id: "cyber-wave",
    name: "Cyber Wave",
    category: "Debit",
    price: 99,
    finish: "Gloss vinyl",
    bg: "linear-gradient(135deg, #25d9ff, #3924ff 44%, #07080d)",
  },
  {
    id: "metro-midnight",
    name: "Metro Midnight",
    category: "Metro",
    price: 99,
    finish: "Matte vinyl",
    bg: "linear-gradient(135deg, #050608, #ffb627 28%, #ff3c8a 58%, #25d9ff)",
  },
  {
    id: "anime-surge",
    name: "Anime Surge",
    category: "Credit",
    price: 99,
    finish: "Satin vinyl",
    bg: "linear-gradient(135deg, #ffffff, #e11d48 38%, #1d4ed8 74%, #09090b)",
  },
  {
    id: "black-gold",
    name: "Black Gold",
    category: "Debit",
    price: 99,
    finish: "Soft-touch vinyl",
    bg: "linear-gradient(135deg, #030712, #111827 42%, #ffb627 43%, #f59e0b)",
  },
  {
    id: "pixel-pop",
    name: "Pixel Pop",
    category: "Metro",
    price: 99,
    finish: "Gloss vinyl",
    bg: "linear-gradient(135deg, #cbff38, #25d9ff 32%, #ff3c8a 64%, #111827)",
  },
  {
    id: "carbon-rush",
    name: "Carbon Rush",
    category: "Credit",
    price: 99,
    finish: "Textured vinyl",
    bg: "linear-gradient(135deg, #111827, #374151 40%, #ff6b35 41%, #ffb627)",
  },
  {
    id: "silver-static",
    name: "Silver Static",
    category: "Debit",
    price: 99,
    finish: "Satin vinyl",
    bg: "linear-gradient(135deg, #e5e7eb, #94a3b8 45%, #25d9ff 46%, #0f172a)",
  },
];

let cart = JSON.parse(localStorage.getItem("carddesign-cart") || "{}");

products.forEach((p) => {
  if (typeof p.stock !== "number") p.stock = 100;
});

async function loadLiveProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) return;
    const data = await response.json();
    (data.products || []).forEach((live) => {
      const local = products.find((p) => p.id === live.id);
      if (!local) return;
      if (typeof live.price === "number") local.price = live.price;
      if (typeof live.stock === "number") local.stock = live.stock;
      if (typeof live.name === "string" && live.name) local.name = live.name;
      if (typeof live.image === "string" && live.image) local.image = live.image;
      if (typeof live.description === "string") local.description = live.description;
    });
    document.dispatchEvent(new CustomEvent("products:updated"));
    renderSharedCart();
  } catch {}
}
loadLiveProducts();

function formatCurrency(value) {
  return `Rs ${value.toLocaleString("en-IN")}`;
}

function saveCart() {
  localStorage.setItem("carddesign-cart", JSON.stringify(cart));
}

function getCartLines() {
  return Object.entries(cart)
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return product ? { ...product, quantity } : null;
    })
    .filter(Boolean);
}

function getGrossSubtotal() {
  return getCartLines().reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function getBuy2Get1Discount() {
  const lines = getCartLines();
  const unitPrices = [];
  lines.forEach((item) => {
    for (let i = 0; i < item.quantity; i += 1) unitPrices.push(item.price);
  });
  unitPrices.sort((a, b) => a - b);
  const freeCount = Math.floor(unitPrices.length / 3);
  let discount = 0;
  for (let i = 0; i < freeCount; i += 1) discount += unitPrices[i];
  return discount;
}

function getSubtotal() {
  return getGrossSubtotal() - getBuy2Get1Discount();
}

function getShippingCost() {
  const subtotal = getSubtotal();
  return subtotal >= 499 || subtotal === 0 ? 0 : 49;
}

function getTotal() {
  return getSubtotal() + getShippingCost();
}

function showToast(message) {
  let toast = document.querySelector("#cartToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "cartToast";
    toast.className = "cart-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 1800);
}

function addToCart(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  if (product.stock <= 0) {
    showToast(`${product.name} is out of stock`);
    return;
  }
  const current = cart[id] || 0;
  if (current + 1 > product.stock) {
    showToast(`Only ${product.stock} of ${product.name} available`);
    return;
  }
  cart[id] = current + 1;
  saveCart();
  renderSharedCart();
  showToast(`Added ${product.name} to cart`);
}

function decreaseCart(id) {
  if (!cart[id]) return;
  cart[id] -= 1;
  if (cart[id] <= 0) delete cart[id];
  saveCart();
  renderSharedCart();
}

function renderSharedCart() {
  const lines = getCartLines();
  const itemCount = lines.reduce((sum, item) => sum + item.quantity, 0);
  const cartCount = document.querySelector("#cartCount");
  const drawerTotal = document.querySelector("#drawerTotal");
  const drawerSubtotal = document.querySelector("#drawerSubtotal");
  const drawerShipping = document.querySelector("#drawerShipping");
  const drawerDiscountRow = document.querySelector("#drawerDiscountRow");
  const drawerDiscount = document.querySelector("#drawerDiscount");
  const cartPromoMsg = document.querySelector("#cartPromoMsg");
  const cartShipMsg = document.querySelector("#cartShipMsg");
  const cartItems = document.querySelector("#cartItems");

  const discountValue = getBuy2Get1Discount();
  const subtotal = getSubtotal();
  const shippingCost = getShippingCost();

  if (cartCount) cartCount.textContent = itemCount;
  if (drawerSubtotal) drawerSubtotal.textContent = formatCurrency(getGrossSubtotal());
  if (drawerShipping) {
    if (itemCount === 0) {
      drawerShipping.textContent = "—";
    } else {
      drawerShipping.textContent = shippingCost === 0 ? "Free" : formatCurrency(shippingCost);
    }
  }
  if (drawerDiscountRow && drawerDiscount) {
    if (discountValue > 0) {
      drawerDiscountRow.hidden = false;
      drawerDiscount.textContent = `- ${formatCurrency(discountValue)}`;
    } else {
      drawerDiscountRow.hidden = true;
    }
  }
  if (drawerTotal) drawerTotal.textContent = formatCurrency(getTotal());

  if (cartPromoMsg) {
    const remainder = itemCount % 3;
    if (itemCount === 0) {
      cartPromoMsg.textContent = "Buy 2 get 1 free on every 3rd item.";
    } else if (remainder === 0) {
      cartPromoMsg.textContent = `Buy 2 get 1 free applied${discountValue > 0 ? ` (${formatCurrency(discountValue)} off)` : ""}.`;
    } else {
      const need = 3 - remainder;
      cartPromoMsg.textContent = `Add ${need} more item${need === 1 ? "" : "s"} to get 1 free.`;
    }
  }

  if (cartShipMsg) {
    if (subtotal === 0) {
      cartShipMsg.textContent = "Free shipping over Rs 499.";
    } else if (shippingCost === 0) {
      cartShipMsg.textContent = "Free shipping unlocked.";
    } else {
      const left = 499 - subtotal;
      cartShipMsg.textContent = `Add ${formatCurrency(left)} more for free shipping.`;
    }
  }
  if (cartItems) {
    cartItems.innerHTML = lines.length
      ? lines
          .map(
            (item) => `
              <div class="cart-item">
                <div class="cart-thumb" style="${item.image ? `background:#111 center/cover url('${item.image}');` : `--skin-bg: ${item.bg};`}"></div>
                <div>
                  <strong>${item.name}</strong>
                  <span>${formatCurrency(item.price)} · ${item.finish}</span>
                </div>
                <div class="qty-controls" aria-label="${item.name} quantity controls">
                  <button type="button" data-decrease="${item.id}">-</button>
                  <strong>${item.quantity}</strong>
                  <button type="button" data-add="${item.id}">+</button>
                </div>
              </div>
            `,
          )
          .join("")
      : `<p class="muted">Your cart is empty.</p>`;
  }
}

function setupCartDrawer() {
  const cartButton = document.querySelector("#cartButton");
  const closeCartButton = document.querySelector("#closeCartButton");
  const cartDrawer = document.querySelector("#cartDrawer");

  if (!cartDrawer) return;

  cartButton?.addEventListener("click", () => {
    cartDrawer.classList.add("open");
    cartDrawer.setAttribute("aria-hidden", "false");
  });

  closeCartButton?.addEventListener("click", () => {
    cartDrawer.classList.remove("open");
    cartDrawer.setAttribute("aria-hidden", "true");
  });

  cartDrawer.addEventListener("click", (event) => {
    if (event.target === cartDrawer) {
      cartDrawer.classList.remove("open");
      cartDrawer.setAttribute("aria-hidden", "true");
    }
  });
}

document.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add]");
  const decreaseButton = event.target.closest("[data-decrease]");

  if (addButton) addToCart(addButton.dataset.add);
  if (decreaseButton) decreaseCart(decreaseButton.dataset.decrease);
});

setupCartDrawer();
renderSharedCart();
