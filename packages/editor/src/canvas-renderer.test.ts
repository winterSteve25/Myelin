import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, cullMarginWorld } from './canvas-renderer';
import { type CanvasViewport, MAX_ZOOM, MIN_ZOOM } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { PlacementController } from './placement-controller';
import type { ITool } from './tools/tool';

const { frameOrder } = vi.hoisted(() => ({ frameOrder: [] as string[] }));

afterEach(() => vi.unstubAllGlobals());

vi.mock('./rendering/painter', () => ({
  WebGLPainter: class {
    beginFrame() {
      frameOrder.push('clear');
      return true;
    }
    endFrame() {
      frameOrder.push('present');
    }
    scale() {}
    translate() {}
  },
}));

it('draws all elements before selection and tool feedback on the same foreground', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  frameOrder.length = 0;
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas);
  const viewport = {
    zoom: 1,
    offset: { x: 0, y: 0 },
    getWorldRect: () => new DOMRect(0, 0, 800, 600),
    screenToWorld: () => ({ x: 0, y: 0 }),
  } as unknown as CanvasViewport;
  const elements = ['ink', 'image'].map((name) => ({
    intersectsWorldRect: () => true,
    hasSelectionOverlay: true,
    draw: (ctx: unknown) => {
      expect(ctx).toBe(renderer.ctx);
      frameOrder.push(name);
    },
    drawSelectionOverlay: (ctx: unknown) => {
      expect(ctx).toBe(renderer.ctx);
      frameOrder.push(`${name}-selection`);
    },
  })) as unknown as DrawableElement[];
  const tool = {
    drawCursor: () => frameOrder.push('cursor'),
  } as unknown as ITool;
  renderer.redraw(
    0.016,
    viewport,
    elements,
    null,
    tool,
    { x: 0, y: 0 },
    { isActive: false } as PlacementController,
    null,
  );
  expect(frameOrder).toEqual([
    'clear',
    'ink',
    'image',
    'ink-selection',
    'image-selection',
    'cursor',
    'present',
  ]);
});

describe('cullMarginWorld', () => {
  it('is a constant band in screen pixels, whatever the zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.5, 1, 4, MAX_ZOOM]) {
      expect(cullMarginWorld(zoom) * zoom).toBeCloseTo(128, 6);
    }
  });

  it('shrinks in world units as the view zooms in', () => {
    expect(cullMarginWorld(4)).toBeLessThan(cullMarginWorld(1));
    expect(cullMarginWorld(1)).toBeLessThan(cullMarginWorld(0.25));
  });

  it('culls nothing when the zoom is unusable', () => {
    // Before the viewport has been measured. An unbounded margin keeps every element in frame: a bad
    // frame is recoverable, a blank canvas reads as data loss.
    for (const zoom of [0, -1, Number.NaN]) {
      expect(cullMarginWorld(zoom)).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
