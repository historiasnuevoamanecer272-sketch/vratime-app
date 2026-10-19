import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeConnection } from '../lib/connectionState';

export default function OfflineNotice(){
  const {t}=useTranslation();
  const [online,setOnline]=useState(()=>globalThis.navigator?.onLine!==false);
  useEffect(()=>subscribeConnection(window,setOnline),[]);
  return online?null:<aside className="connection-notice" role="status"><details><summary>{t('reliabilityExperience.offlineShort')}</summary><p>{t('reliabilityExperience.offline')}</p></details></aside>;
}
