// This records only a successful standalone activation, never a coordinate or
// a permission grant. The device still decides every native location request.
export function createLocationStartup({standalone = false, storage} = {}) {
  const key = 'farmakeia.standalone-location.v1';
  let activated = false;
  if (standalone) {
    try { activated = storage?.getItem(key) === '1'; } catch {}
  }
  const remember = value => {
    if (!standalone) return;
    activated = value;
    try {
      if (value) storage?.setItem(key, '1');
      else storage?.removeItem(key);
    } catch {}
  };
  return {
    get automatic() { return !standalone || activated; },
    succeeded() { remember(true); },
    denied() { remember(false); },
    paused() { remember(false); }
  };
}
