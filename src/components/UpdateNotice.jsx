import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyPwaUpdate, getPwaUpdateState, subscribePwaUpdate } from '../lib/pwaUpdate';
export default function UpdateNotice() {
  const {t}=useTranslation();
  const [pending,setPending]=useState(getPwaUpdateState);
  useEffect(()=>subscribePwaUpdate(setPending),[]);
  if(!pending)return null;
  return <aside className="connection-notice" role="status"><p>{t('pwaExperience.available')}</p><button type="button" className="btn-secondary mt-2" onClick={()=>{if(window.confirm(t('pwaExperience.confirm')))applyPwaUpdate();}}>{t('pwaExperience.update')}</button></aside>;
}
