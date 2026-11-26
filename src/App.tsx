/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eraser,
  Flashlight,
  Hand,
  RotateCw,
  Sword,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  FpsSimulatorEngine,
  type HudSnapshot,
  type WeaponId,
} from './fps/engine';

const WEAPON_TABS: Array<{
  id: WeaponId;
  label: string;
  activeClass: string;
}> = [
  { id: 'pistol9mm', label: '1 · 9mm', activeClass: 'bg-white text-[#121519]' },
  { id: 'futuristic', label: '2 · VX-9', activeClass: 'bg-[#ff5a10] text-white' },
  { id: 'rustSmg', label: '3 · PP-41', activeClass: 'bg-[#b45309] text-white' },
  { id: 'retroSmg', label: '4 · AK-74M', activeClass: 'bg-[#0891b2] text-white' },
  { id: 'rustShotgun', label: '5 · KS-23', activeClass: 'bg-[#991b1b] text-white' },
  { id: 'sword', label: '6 · Blade', activeClass: 'bg-[#e2e8f0] text-[#0f172a]' },
  { id: 'flashlight', label: '7 · Light', activeClass: 'bg-[#facc15] text-[#111418]' },
  { id: 'unarmed', label: '8 · Empty', activeClass: 'bg-white/25 text-white' },
];

function getWeaponSubtitle(hud: HudSnapshot): string {
  if (hud.actionLabel) return hud.actionLabel;
  if (hud.weaponId === 'unarmed') return 'Unarmed · Hands Free';
  if (hud.weaponId === 'sword') {
    if (hud.isReloading) return 'Blade Flourish';
    if (hud.isAds) return 'Defensive Guard';
    return 'Katana · 3-Hit Combo';
  }
  if (hud.weaponId === 'flashlight') {
    if (hud.isReloading) return 'Bulb Check';
    if (hud.isAds) return hud.flashlightOn ? 'Focused Beam' : 'Light Off (LMB / F)';
    return hud.flashlightOn ? 'Flashlight · ON' : 'Flashlight · OFF';
  }
  if (hud.isReloading) return 'Reloading';
  if (hud.ammo === 0) return 'Empty — press R';
  if (hud.isAds) {
    if (hud.weaponId === 'futuristic') return 'Red Dot Sight';
    if (hud.weaponId === 'retroSmg') return 'Kobra Reflex';
    if (hud.weaponId === 'rustShotgun') return 'Phosphor Optic';
    return 'Iron Sights';
  }
  switch (hud.weaponId) {
    case 'futuristic':
      return 'VX-9 Shotgun';
    case 'rustSmg':
      return 'PP-41 Buria · Auto';
    case 'retroSmg':
      return 'AK-74M Pulse · Auto';
    case 'rustShotgun':
      return 'KS-23 Vostok';
    default:
      return '9×19mm';
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FpsSimulatorEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>({
    ammo: 15,
    maxAmmo: 15,
    weaponId: 'pistol9mm',
    isAds: false,
    adsBlend: 0,
    isReloading: false,
    isLocked: false,
    shotsFired: 0,
    flashlightOn: false,
    pickupPrompt: null,
    pickupKind: null,
    actionLabel: null,
  });

  const [adsToggleMode, setAdsToggleMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [hudVisible, setHudVisible] = useState(true);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const engine = new FpsSimulatorEngine(el, (snap) => {
      setHud(snap);
    });
    engineRef.current = engine;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setHudVisible((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleAdsModeToggle = () => {
    const next = !adsToggleMode;
    setAdsToggleMode(next);
    engineRef.current?.setAdsToggleMode(next);
  };

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.setMuted(next);
  };

  const crosshairOpacity = Math.max(0, 1 - hud.adsBlend * 1.45);
  const crosshairSpread = 10 + (1 - hud.adsBlend) * 5;
  const isFirearm =
    hud.weaponId !== 'sword' &&
    hud.weaponId !== 'flashlight' &&
    hud.weaponId !== 'unarmed';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#121519]">
      {/* Isolated WebGL canvas container */}
      <div ref={mountRef} className="w-full h-full cursor-crosshair" />

      {/* Center dynamic hip-fire reticle (fades cleanly out in ADS) */}
      {hudVisible && crosshairOpacity > 0.02 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center"
          style={{ opacity: crosshairOpacity }}
        >
          <div className="relative w-12 h-12">
            <span
              className="absolute left-1/2 -translate-x-1/2 w-[1.5px] h-[7px] bg-white/85"
              style={{
                top: `calc(50% - ${crosshairSpread + 7}px)`,
                boxShadow: '0 0 2px rgba(0,0,0,0.7)',
              }}
            />
            <span
              className="absolute left-1/2 -translate-x-1/2 w-[1.5px] h-[7px] bg-white/85"
              style={{
                top: `calc(50% + ${crosshairSpread}px)`,
                boxShadow: '0 0 2px rgba(0,0,0,0.7)',
              }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-[1.5px] w-[7px] bg-white/85"
              style={{
                left: `calc(50% - ${crosshairSpread + 7}px)`,
                boxShadow: '0 0 2px rgba(0,0,0,0.7)',
              }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-[1.5px] w-[7px] bg-white/85"
              style={{
                left: `calc(50% + ${crosshairSpread}px)`,
                boxShadow: '0 0 2px rgba(0,0,0,0.7)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-[2px] rounded-full bg-white/90"
              style={{ boxShadow: '0 0 2px rgba(0,0,0,0.8)' }}
            />
          </div>
        </div>
      )}

      {/* Contextual Ground Pickup Prompt (D⚡ Drinks, Floor Guns, General Supplies) */}
      {hudVisible && hud.pickupPrompt && (
        <div className="pointer-events-none fixed left-1/2 top-[58%] -translate-x-1/2 z-20 flex items-center gap-2 rounded-lg border border-white/15 bg-[#12151ad9] px-3.5 py-1.5 shadow-lg">
          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#111418]">
            E
          </span>
          <span className="text-xs font-medium text-white/95">
            {hud.pickupKind === 'drink'
              ? `Pick up & Drink · ${hud.pickupPrompt}`
              : hud.pickupKind === 'weapon'
                ? `Pick up Weapon · ${hud.pickupPrompt}`
                : `Pick up · ${hud.pickupPrompt}`}
          </span>
        </div>
      )}

      {/* Minimal Top-Left Controls Key */}
      {hudVisible && (
        <div className="pointer-events-none fixed top-5 left-6 z-20 flex flex-col gap-1">
          <h1 className="text-sm font-medium tracking-tight text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]">
            Tactical Sightline
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
            <span>LMB Fire</span>
            <span aria-hidden="true">·</span>
            <span>RMB / Q ADS</span>
            <span aria-hidden="true">·</span>
            <span>R Reload</span>
            <span aria-hidden="true">·</span>
            <span>Shift Run</span>
            <span aria-hidden="true">·</span>
            <span>C Slide / Crouch</span>
            <span aria-hidden="true">·</span>
            <span>Space Jump</span>
            <span aria-hidden="true">·</span>
            <span>F Light</span>
            <span aria-hidden="true">·</span>
            <span>E Interact</span>
            <span aria-hidden="true">·</span>
            <span>1–8 Swap</span>
          </div>
        </div>
      )}

      {/* Minimal Bottom-Right Weapon / Ammo Readout */}
      {hudVisible && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-20 flex flex-col items-end">
          {isFirearm ? (
            <div className="font-mono-tabular text-3xl font-medium tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
              <span className={hud.ammo === 0 ? 'text-red-400' : 'text-white'}>
                {String(hud.ammo).padStart(2, '0')}
              </span>
              <span className="mx-1.5 text-lg text-white/45">/</span>
              <span className="text-lg text-white/65">{hud.maxAmmo}</span>
            </div>
          ) : (
            <div className="font-mono-tabular text-2xl font-medium tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
              {hud.weaponId === 'unarmed'
                ? 'UNARMED'
                : hud.weaponId === 'sword'
                  ? 'BLADE'
                  : hud.flashlightOn
                    ? 'LIGHT ON'
                    : 'LIGHT OFF'}
            </div>
          )}
          <span className="text-xs text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">
            {getWeaponSubtitle(hud)}
            {isFirearm && hud.flashlightOn ? ' · Light ON' : ''}
          </span>
        </div>
      )}

      {/* Discreet pointer lock hint when unlocked */}
      {hudVisible && !hud.isLocked && (
        <div className="pointer-events-none fixed top-5 right-6 z-20">
          <span className="text-xs text-white/75 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
            Click room to lock mouse look · Esc to release
          </span>
        </div>
      )}

      {/* Minimal Collapsible Bottom Mechanics Dock */}
      {hudVisible && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setDockOpen((v) => !v)}
            className="mb-1.5 flex items-center gap-1.5 rounded-md border border-white/12 bg-[#14171ce0] px-3 py-1 text-xs font-medium text-white/80 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {dockOpen ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Hide Controls</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show Controls</span>
              </>
            )}
          </button>

          {dockOpen && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#14171ceb] px-2.5 py-2 shadow-xl max-w-[96vw]">
              {/* 7-Item Arsenal Selector */}
              <div className="flex items-center rounded-lg bg-white/6 p-0.5 shrink-0">
                {WEAPON_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => engineRef.current?.switchWeapon(tab.id)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      hud.weaponId === tab.id
                        ? tab.activeClass
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="w-px h-4 bg-white/12 shrink-0 hidden sm:block" />

              <button
                type="button"
                onClick={() => engineRef.current?.toggleFlashlight()}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  hud.flashlightOn
                    ? 'bg-[#facc15] text-[#111418]'
                    : 'bg-white/8 text-white/85 hover:bg-white/15'
                }`}
              >
                <Flashlight className="w-3.5 h-3.5" />
                <span>Light (F)</span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.triggerQuickMelee()}
                className="flex items-center gap-1 rounded-lg bg-white/8 px-2.5 py-1.5 text-xs font-medium text-white/85 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0"
              >
                <Sword className="w-3.5 h-3.5" />
                <span>Slash (V)</span>
              </button>

              {hud.pickupPrompt && (
                <button
                  type="button"
                  onClick={() => engineRef.current?.triggerPickup()}
                  className="flex items-center gap-1 rounded-lg bg-[#f59e0b] px-2.5 py-1.5 text-xs font-medium text-[#111418] hover:bg-[#fbbf24] transition-colors whitespace-nowrap shrink-0"
                >
                  <Hand className="w-3.5 h-3.5" />
                  <span>Pick Up (E)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => engineRef.current?.toggleAdsManual()}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  hud.isAds
                    ? 'bg-white text-[#121519]'
                    : 'bg-white/8 text-white/85 hover:bg-white/15'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>
                  {hud.weaponId === 'sword'
                    ? 'Guard'
                    : hud.weaponId === 'flashlight'
                      ? 'Focus'
                      : hud.isAds
                        ? 'Exit ADS'
                        : 'ADS'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleAdsModeToggle}
                className="rounded-lg bg-white/8 px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/15 hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                RMB: {adsToggleMode ? 'Toggle' : 'Hold'}
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.triggerReload()}
                className="flex items-center gap-1 rounded-lg bg-white/8 px-2.5 py-1.5 text-xs font-medium text-white/85 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>
                  {hud.weaponId === 'sword'
                    ? 'Flourish'
                    : hud.weaponId === 'flashlight'
                      ? 'Check'
                      : 'Reload'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.clearBulletHoles()}
                className="flex items-center gap-1 rounded-lg bg-white/8 px-2 py-1.5 text-xs font-medium text-white/80 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0"
                title="Clear bullet holes"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>

              <button
                type="button"
                onClick={handleMuteToggle}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="flex items-center justify-center rounded-lg bg-white/8 p-1.5 text-white/80 hover:bg-white/15 transition-colors shrink-0"
              >
                {muted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {!hudVisible && (
        <button
          type="button"
          onClick={() => setHudVisible(true)}
          className="fixed bottom-4 left-4 z-30 rounded-md border border-white/12 bg-[#14171cc8] px-2.5 py-1 text-xs text-white/70 hover:text-white transition-colors"
        >
          Show HUD (H)
        </button>
      )}
    </div>
  );
}
