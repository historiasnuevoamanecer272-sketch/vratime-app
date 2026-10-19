import { useEffect, useId, useRef, useState } from 'react';
import { languageOptions } from '../i18n/languages';
import Icon from './Icon';

export default function LanguageMenu({ value, onChange, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const optionButtons = useRef([]);
  const menuId = useId();
  const selectedIndex = Math.max(0, languageOptions.findIndex((language) => language.id === value));
  const selected = languageOptions[selectedIndex];

  useEffect(() => {
    if (!open) return undefined;
    optionButtons.current[selectedIndex]?.focus();
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, selectedIndex]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const navigate = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = optionButtons.current.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? languageOptions.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + languageOptions.length) % languageOptions.length;
    optionButtons.current[next]?.focus();
  };

  return <div ref={root} className={`language-menu ${className}`}>
    <button ref={trigger} type="button" className="language-menu-trigger" aria-label={`${label}: ${selected.name}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      if (event.key === 'Escape') close();
    }}><Icon name="globe" size={20} /><span>{selected.label}</span><Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} /></button>
    {open ? <div id={menuId} className="language-menu-panel" role="listbox" aria-label={label} onKeyDown={navigate}>
      {languageOptions.map((language, index) => <button key={language.id} ref={(button) => { optionButtons.current[index] = button; }} type="button" role="option" aria-selected={language.id === selected.id} tabIndex={-1} className={`language-menu-option ${language.id === selected.id ? 'is-selected' : ''}`} onClick={() => { onChange(language.id); close(); }}>
        <span className="language-menu-code">{language.label}</span><span className="language-menu-name" lang={language.id === 'me' ? 'sr-Latn-ME' : language.id}>{language.name}</span>{language.id === selected.id ? <Icon name="check" size={17} /> : null}
      </button>)}
    </div> : null}
  </div>;
}
