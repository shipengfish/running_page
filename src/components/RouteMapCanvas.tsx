import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FullscreenControl,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type CameraOptions,
  type ErrorEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as polyline from '@mapbox/polyline';
import gcoord from 'gcoord';
import type { Activity } from '../types';
import { useLocale } from '../hooks/useLocale';
import './RouteMap.css';

export interface RouteMapProps {
  activities: Activity[];
  selectedActivity?: Activity | null;
  dark?: boolean;
  onClearSelection?: () => void;
}

type RouteLine = {
  type: string;
  coordinates: [number, number][];
};

type BasemapId = 'gaode' | 'openfreemap' | 'osm';

const BASEMAP_ORDER: BasemapId[] = ['gaode', 'osm', 'openfreemap'];

const rasterStyle = (
  tiles: string[],
  background: string,
  attribution: string
): StyleSpecification => ({
  version: 8,
  sources: {
    raster: {
      type: 'raster',
      tiles,
      tileSize: 256,
      attribution,
      maxzoom: 18,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': background },
    },
    { id: 'raster', type: 'raster', source: 'raster' },
  ],
});

const styleFor = (
  id: BasemapId,
  dark: boolean
): string | StyleSpecification => {
  if (id === 'gaode') {
    return rasterStyle(
      [
        dark
          ? '/api/tiles/gaode-dark/{z}/{x}/{y}'
          : '/api/tiles/gaode/{z}/{x}/{y}',
      ],
      dark ? '#1c1c1c' : '#f4f4f0',
      '© 高德地图'
    );
  }
  if (id === 'openfreemap') {
    return dark
      ? 'https://tiles.openfreemap.org/styles/dark'
      : 'https://tiles.openfreemap.org/styles/positron';
  }
  return rasterStyle(
    ['/api/tiles/osm/{z}/{x}/{y}'],
    dark ? '#0e0e0e' : '#fafafa',
    '© OpenStreetMap'
  );
};

const toLngLat = (
  lat: number,
  lng: number,
  toGcj: boolean
): [number, number] | null => {
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 90
  ) {
    return null;
  }
  if (!toGcj) return [lng, lat];
  const converted = gcoord.transform([lng, lat], gcoord.WGS84, gcoord.GCJ02);
  if (
    !Array.isArray(converted) ||
    !Number.isFinite(converted[0]) ||
    !Number.isFinite(converted[1])
  ) {
    return [lng, lat];
  }
  return [converted[0], converted[1]];
};

export function RouteMapCanvas({
  activities,
  selectedActivity,
  dark,
  onClearSelection,
}: RouteMapProps) {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const panelRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleReadyRef = useRef(false);
  const cameraRef = useRef<CameraOptions | null>(null);
  const fittedRef = useRef<unknown>(null);
  const routesRef = useRef<RouteLine[]>([]);
  const selectedRef = useRef(false);
  const [provider, setProvider] = useState<BasemapId>('gaode');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const skipFirstStyleRef = useRef(true);
  const [retry, setRetry] = useState(0);
  const isDark = dark !== false;
  const style = useMemo(() => styleFor(provider, isDark), [provider, isDark]);

  const routes = useMemo(() => {
    const items = selectedActivity ? [selectedActivity] : activities;
    const toGcj = provider === 'gaode';
    return items.flatMap((activity) => {
      if (!activity.summary_polyline) return [];
      try {
        const coordinates = polyline
          .decode(activity.summary_polyline)
          .map(([lat, lng]) => toLngLat(lat, lng, toGcj))
          .filter((point): point is [number, number] => point !== null);
        if (coordinates.length < 2) return [];
        return [{ type: activity.type, coordinates }];
      } catch {
        return [];
      }
    });
  }, [activities, selectedActivity, provider]);

  routesRef.current = routes;
  selectedRef.current = Boolean(selectedActivity);

  const routeBounds = useMemo(() => {
    const bounds = new LngLatBounds();
    for (const route of routes) {
      for (const coord of route.coordinates) bounds.extend(coord);
    }
    return bounds;
  }, [routes]);

  const fitRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map || routeBounds.isEmpty()) return;
    map.fitBounds(routeBounds, {
      padding: { top: 35, bottom: 35, left: 35, right: 65 },
      maxZoom: selectedActivity ? 15 : 12,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 500,
    });
  }, [routeBounds, selectedActivity]);

  const paintTracks = useCallback(() => {
    const map = mapRef.current;
    const canvas = overlayRef.current;
    if (!map || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const selected = selectedRef.current;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const route of routesRef.current) {
      const points = route.coordinates.map(([lng, lat]) =>
        map.project({ lng, lat })
      );
      if (points.length < 2) continue;
      ctx.strokeStyle = '#7c2d12';
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = selected ? 8 : 3.5;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.strokeStyle = '#ea580c';
      ctx.globalAlpha = selected ? 1 : 0.82;
      ctx.lineWidth = selected ? 4.5 : 2;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || !panelRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style,
      center: [121.4, 31.2],
      zoom: 10,
      ...cameraRef.current,
      locale: zh
        ? {
            'Map.Title': '跑步路线地图',
            'NavigationControl.ZoomIn': '放大',
            'NavigationControl.ZoomOut': '缩小',
            'NavigationControl.ResetBearing': '恢复朝北',
            'FullscreenControl.Enter': '全屏查看',
            'FullscreenControl.Exit': '退出全屏',
            'AttributionControl.ToggleAttribution': '地图来源',
          }
        : undefined,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl(), 'top-right');
    map.addControl(
      new FullscreenControl({ container: panelRef.current }),
      'top-right'
    );
    map.addControl(
      new ScaleControl({ unit: 'metric', maxWidth: 90 }),
      'bottom-left'
    );
    const markReady = () => {
      styleReadyRef.current = true;
      setStatus('ready');
      paintTracks();
      if (fittedRef.current !== routesRef.current) {
        fittedRef.current = routesRef.current;
        fitRoutes();
      }
    };
    map.on('load', markReady);
    map.on('style.load', markReady);
    map.on('render', paintTracks);
    const observer = new ResizeObserver(() => {
      map.resize();
      paintTracks();
    });
    observer.observe(containerRef.current);
    return () => {
      cameraRef.current = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
      observer.disconnect();
      map.off('load', markReady);
      map.off('style.load', markReady);
      map.off('render', paintTracks);
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
    // Recreate the map only when language changes. Style swaps use setStyle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zh]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (skipFirstStyleRef.current) {
      skipFirstStyleRef.current = false;
      return;
    }
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      const index = BASEMAP_ORDER.indexOf(provider);
      const next = BASEMAP_ORDER[index + 1];
      if (next) {
        setProvider(next);
        return;
      }
      setStatus('error');
    };
    const onError = (event: ErrorEvent) => {
      const message = event.error?.message || '';
      if (/glyph|sprite|\.pbf|raster|tile/i.test(message)) return;
      if (
        /Failed to fetch|Could not load style|AJAXError|status (4|5)/i.test(
          message
        )
      ) {
        fail();
      }
    };
    map.on('error', onError);
    styleReadyRef.current = false;
    setStatus('loading');
    map.setStyle(style, { diff: false });
    const timer = window.setTimeout(() => {
      if (!styleReadyRef.current) fail();
    }, 12000);
    return () => {
      window.clearTimeout(timer);
      map.off('error', onError);
    };
  }, [style, provider, retry]);

  useEffect(() => {
    paintTracks();
    if (fittedRef.current !== routes) {
      fittedRef.current = routes;
      fitRoutes();
    }
  }, [routes, paintTracks, fitRoutes]);

  useEffect(() => {
    let wasFullscreen = document.fullscreenElement === panelRef.current;
    let frame = 0;
    const onFullscreen = () => {
      const isFullscreen = document.fullscreenElement === panelRef.current;
      if (isFullscreen || wasFullscreen) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          mapRef.current?.resize();
          paintTracks();
          fitRoutes();
        });
      }
      wasFullscreen = isFullscreen;
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [fitRoutes, paintTracks]);

  const providerLabel =
    provider === 'gaode'
      ? zh
        ? '底图 · 高德'
        : 'Basemap · Amap'
      : provider === 'osm'
        ? 'OpenStreetMap'
        : 'OpenFreeMap';

  return (
    <section
      ref={panelRef}
      className="route-map"
      aria-label={zh ? '路线地图' : 'Route map'}
    >
      <div className="route-map-header">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {zh ? '路线地图' : 'Route map'}
          </h2>
          <p
            className="truncate text-xs text-[var(--color-muted)]"
            title={selectedActivity?.name}
          >
            {selectedActivity
              ? `${selectedActivity.name} · ${(selectedActivity.distance / 1000).toFixed(1)} km`
              : `${routes.length.toLocaleString()} ${zh ? '条轨迹' : 'routes'}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {selectedActivity && onClearSelection && (
            <button className="route-map-action" onClick={onClearSelection}>
              {zh ? '返回总览' : 'Overview'}
            </button>
          )}
          <button
            className="route-map-action"
            disabled={!routes.length}
            onClick={fitRoutes}
            title={zh ? '将所有当前轨迹完整放入视野' : 'Fit all current routes'}
          >
            {zh ? '定位轨迹' : 'Fit routes'}
          </button>
        </div>
      </div>
      <div className="route-map-body">
        <div ref={containerRef} className="h-full w-full" />
        <canvas
          ref={overlayRef}
          className="route-map-track-overlay"
          aria-hidden="true"
        />
        {!routes.length && (
          <div className="route-map-empty" role="status">
            {zh
              ? selectedActivity
                ? '这次活动没有 GPS 轨迹'
                : '当前筛选没有 GPS 轨迹'
              : 'No GPS route available'}
          </div>
        )}
      </div>
      <div className="route-map-footer">
        <span role="status" aria-live="polite">
          {status === 'error'
            ? zh
              ? '底图加载失败，请重试'
              : 'Basemap failed to load'
            : status === 'loading'
              ? zh
                ? '正在加载地图…'
                : 'Loading map…'
              : providerLabel}
        </span>
        {status === 'error' && (
          <button
            className="route-map-action"
            onClick={() => {
              setProvider('gaode');
              setRetry((value) => value + 1);
            }}
          >
            {zh ? '重试' : 'Retry'}
          </button>
        )}
      </div>
    </section>
  );
}
