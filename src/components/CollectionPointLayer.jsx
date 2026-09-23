import { Marker, Popup, Tooltip } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { mapMarkerIcons } from '../lib/mapMarkers';
import { collectionPointTypeLabel } from '../lib/collectionPointTypes';
import { getAppLanguage } from '../i18n';
import Icon from './Icon';

export default function CollectionPointLayer({ points, onVote, onSelect }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  return points.map((point) => <Marker key={point.id} position={[Number(point.lat), Number(point.lng)]} icon={mapMarkerIcons.collection} title={point.name}>
    <Tooltip direction="top" offset={[0, -35]} opacity={1}><div className="point-tooltip"><strong>{point.name}</strong><small>{point.materials?.map((key) => collectionPointTypeLabel(key, language)).join(' · ')}</small><span>{t(`points.${point.status}`)}</span></div></Tooltip>
    <Popup><article className="collection-point-popup"><p className={`point-status ${point.status}`}><Icon name={point.status === 'verified' ? 'check' : 'clock'} size={14} />{t(`points.${point.status}`)}</p><h3>{point.name}</h3><p>{point.location_label}</p>{point.description ? <small>{point.description}</small> : null}<div className="point-materials">{point.materials?.map((key) => <span key={key}>{collectionPointTypeLabel(key, language)}</span>)}</div><p className="point-votes">{t('points.voteSummary', { exists: point.exists_votes, missing: point.missing_votes })}</p><div className="point-actions"><button type="button" onClick={() => onVote(point, 'exists')}><Icon name="check" size={15} />{t('points.exists')}</button><button type="button" onClick={() => onVote(point, 'missing')}><Icon name="close" size={15} />{t('points.missing')}</button></div>{onSelect ? <button type="button" className="btn-link" onClick={() => onSelect(point)}>{t('points.details')}</button> : null}</article></Popup>
  </Marker>);
}
