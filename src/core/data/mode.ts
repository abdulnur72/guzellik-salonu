// Demo modu: kayıtlar yalnızca bu tarayıcıda durur, sunucu gerekmez.
// `npm run dev` demo modunda açılır (.env.development). Yayına alınan
// sürüm (npm run build) sunucuya bağlı gerçek moddur.
export const isDemo = import.meta.env?.VITE_DEMO === '1'
