// Companero del componente .btn (ver el <style type="text/tailwindcss"> en
// index.html): las clases se usan directo en el HTML de cada vista
// (class="btn btn-primary"), esto solo centraliza el UNICO estado con
// comportamiento (loading), que hasta ahora cada formulario reimplementaba
// a mano con su propia combinacion de disabled/opacity/texto (ver auth.js).
export function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) btn.setAttribute('data-loading', '');
  else btn.removeAttribute('data-loading');
}
