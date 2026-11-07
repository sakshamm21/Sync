'use client';

/**
 * An interactive OpenStreetMap map (Roadmap "Next" #8): pins for venues,
 * pan and zoom, and, when picking a location, tap anywhere to drop a pin.
 * Uses circle markers, so no marker images need bundling.
 */
import { useEffect, useRef } from 'react';
import type { Map as LeafletMapInstance, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPin {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Shown bigger and filled. */
  active?: boolean;
}

export default function LeafletMap({
  center,
  pins,
  onSelect,
  onDrop,
  className,
}: {
  center: { latitude: number; longitude: number };
  pins: MapPin[];
  onSelect?: (pin: MapPin) => void;
  /** When set, tapping the map drops a pin there. */
  onDrop?: (latitude: number, longitude: number) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMapInstance | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const handlers = useRef({ onSelect, onDrop });
  handlers.current = { onSelect, onDrop };
  // The latest pins, so the first draw after Leaflet loads isn't stale.
  const latestPins = useRef(pins);
  latestPins.current = pins;

  // Create the map once (Leaflet touches `window`, so it loads in the browser only).
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !box.current || map.current) return;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(
        [center.latitude, center.longitude],
        16
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      m.on('click', (e) => handlers.current.onDrop?.(e.latlng.lat, e.latlng.lng));
      map.current = m;
      draw(L);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(L: typeof import('leaflet')) {
    if (!layer.current) return;
    layer.current.clearLayers();
    for (const pin of latestPins.current) {
      L.circleMarker([pin.latitude, pin.longitude], {
        radius: pin.active ? 11 : 8,
        color: '#09090d',
        weight: 2,
        fillColor: pin.active ? '#d4ff3a' : '#6a3dff',
        fillOpacity: 0.95,
      })
        .bindTooltip(pin.name)
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          handlers.current.onSelect?.(pin);
        })
        .addTo(layer.current);
    }
  }

  // Redraw pins and follow the selection.
  useEffect(() => {
    if (!map.current) return;
    void import('leaflet').then((L) => draw(L));
    map.current.panTo([center.latitude, center.longitude]);
  }, [pins, center.latitude, center.longitude]);

  return <div ref={box} className={className} role="region" aria-label="Map" />;
}
