// ====== AYARLAR — kendi bilgilerinizle değiştirin ======
// WhatsApp numarası: ülke kodu ile, boşluksuz, başında + olmadan (ör. 905321234567)
const WHATSAPP_NUMBER = "905000000000";

// Hizmetler ve fiyatlar (örnek)
const SERVICES = [
  {
    icon: "💇‍♀️",
    title: "Saç",
    items: [
      ["Kesim & Fön", "600 ₺"],
      ["Boya (dip)", "1.200 ₺"],
      ["Röfle / Balyaj", "2.500 ₺"],
      ["Keratin Bakımı", "3.000 ₺"],
    ],
  },
  {
    icon: "🧖‍♀️",
    title: "Cilt Bakımı",
    items: [
      ["Klasik Cilt Bakımı", "1.000 ₺"],
      ["Hydrafacial", "1.800 ₺"],
      ["Leke Bakımı", "1.500 ₺"],
    ],
  },
  {
    icon: "💅",
    title: "Manikür & Pedikür",
    items: [
      ["Manikür", "400 ₺"],
      ["Pedikür", "500 ₺"],
      ["Kalıcı Oje", "550 ₺"],
      ["Protez Tırnak", "1.200 ₺"],
    ],
  },
  {
    icon: "👁️",
    title: "Kaş & Kirpik",
    items: [
      ["Kaş Alma", "150 ₺"],
      ["Kirpik Lifting", "800 ₺"],
      ["İpek Kirpik", "1.500 ₺"],
      ["Kaş Laminasyonu", "700 ₺"],
    ],
  },
  {
    icon: "✨",
    title: "Ağda",
    items: [
      ["Yüz Ağda", "200 ₺"],
      ["Kol Ağda", "300 ₺"],
      ["Bacak Ağda", "450 ₺"],
      ["Tüm Vücut", "1.200 ₺"],
    ],
  },
  {
    icon: "💄",
    title: "Makyaj",
    items: [
      ["Günlük Makyaj", "800 ₺"],
      ["Gece Makyajı", "1.200 ₺"],
      ["Gelin Makyajı", "4.000 ₺"],
    ],
  },
];

// Çalışma saatleri: gün numarası (0=Pazar … 6=Cumartesi) → [açılış, kapanış] saat
const HOURS = {
  0: null,
  1: [9, 20], 2: [9, 20], 3: [9, 20], 4: [9, 20], 5: [9, 20],
  6: [9, 18],
};
// ========================================================

// Hizmet kartlarını ve seçim listesini doldur
const servicesEl = document.getElementById("services");
const serviceSelect = document.getElementById("service-select");

SERVICES.forEach((group) => {
  const card = document.createElement("article");
  card.className = "service-card";
  card.innerHTML = `
    <div class="service-card__icon" aria-hidden="true">${group.icon}</div>
    <h3>${group.title}</h3>
    <ul>${group.items.map(([n, p]) => `<li><span>${n}</span><span>${p}</span></li>`).join("")}</ul>`;
  servicesEl.appendChild(card);

  const optgroup = document.createElement("optgroup");
  optgroup.label = group.title;
  group.items.forEach(([name]) => optgroup.appendChild(new Option(name, name)));
  serviceSelect.appendChild(optgroup);
});

// Mobil menü
const toggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", open);
});
nav.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  })
);

// Tarih & saat
const form = document.getElementById("appointment-form");
const dateInput = form.elements.date;
const timeSelect = document.getElementById("time-select");
const errorEl = document.getElementById("form-error");

const pad = (n) => String(n).padStart(2, "0");
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
dateInput.min = toISODate(new Date());

function fillTimes() {
  timeSelect.innerHTML = '<option value="">Saat seçin</option>';
  errorEl.textContent = "";
  if (!dateInput.value) return;

  const [y, m, d] = dateInput.value.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const hours = HOURS[day.getDay()];
  if (!hours) {
    errorEl.textContent = "Seçtiğiniz gün salonumuz kapalıdır. Lütfen başka bir gün seçin.";
    return;
  }

  const now = new Date();
  const isToday = toISODate(now) === dateInput.value;
  for (let h = hours[0]; h < hours[1]; h++) {
    for (const min of [0, 30]) {
      if (isToday && (h < now.getHours() + 1 || (h === now.getHours() + 1 && min < now.getMinutes()))) continue;
      const t = `${pad(h)}:${pad(min)}`;
      timeSelect.appendChild(new Option(t, t));
    }
  }
  if (timeSelect.options.length === 1) {
    errorEl.textContent = "Bugün için uygun saat kalmadı. Lütfen başka bir gün seçin.";
  }
}
dateInput.addEventListener("change", fillTimes);

// Form gönderimi → WhatsApp
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = form.elements;
  const name = f.name.value.trim();
  const phone = f.phone.value.trim();

  if (!name || !phone || !f.service.value || !f.date.value || !f.time.value) {
    errorEl.textContent = "Lütfen tüm zorunlu alanları doldurun.";
    return;
  }
  if (phone.replace(/\D/g, "").length < 10) {
    errorEl.textContent = "Lütfen geçerli bir telefon numarası girin.";
    return;
  }
  errorEl.textContent = "";

  const [y, m, d] = f.date.value.split("-");
  const lines = [
    "Merhaba, randevu almak istiyorum.",
    `Ad Soyad: ${name}`,
    `Telefon: ${phone}`,
    `Hizmet: ${f.service.value}`,
    `Tarih: ${d}.${m}.${y}`,
    `Saat: ${f.time.value}`,
  ];
  if (f.note.value.trim()) lines.push(`Not: ${f.note.value.trim()}`);

  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
});

// Yüzen WhatsApp düğmesi ve yıl
document.getElementById("wa-float").href =
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Merhaba, bilgi almak istiyorum.")}`;
document.getElementById("year").textContent = new Date().getFullYear();
