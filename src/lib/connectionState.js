export function subscribeConnection(host, onChange) {
  const update=()=>onChange(host.navigator?.onLine !== false);
  host.addEventListener('online',update);
  host.addEventListener('offline',update);
  return ()=>{host.removeEventListener('online',update);host.removeEventListener('offline',update);};
}
