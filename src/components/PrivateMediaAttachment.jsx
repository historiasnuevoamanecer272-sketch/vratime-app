import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPrivateMediaUrl } from '../lib/mediaUploads';
import { supabase } from '../supabaseClient';
import { friendlyError } from '../lib/userErrors';
import MediaPreview from './MediaPreview';

export default function PrivateMediaAttachment({ reference, userId }) {
  const {t}=useTranslation();
  const [preview,setPreview]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const busy=useRef(false);
  const open=async()=>{
    if(busy.current)return;
    busy.current=true;setLoading(true);setError('');
    try{
      if(reference.startsWith('media:'))setPreview(await getPrivateMediaUrl(reference));
      else{
        const url=new URL(reference),base=new URL(supabase.supabaseUrl);
        if(url.origin!==base.origin||!url.pathname.startsWith(`/storage/v1/object/public/LISTING-PHOTOS/${userId}/feedback/`)||url.username||url.password)throw Error('forbidden');
        setPreview(url.href);
      }
    }catch(failure){setError(friendlyError(failure,t));}
    finally{busy.current=false;setLoading(false);}
  };
  return <><button type="button" className="btn-secondary" disabled={loading} onClick={open}>{t(loading?'common.loading':'workflow.screenshot')}</button>{error?<p className="field-error" role="alert">{error}</p>:null}{preview?<MediaPreview src={preview} onClose={()=>setPreview(null)}/>:null}</>;
}
