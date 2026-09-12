import { getCanvasPalette } from './canvas-theme';
import type { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { Vector2 } from './geometry';
import type { PlacementController } from './placement-controller';
import { BackgroundRenderer } from './rendering/background';
import { WebGLPainter } from './rendering/painter';
import type { ITool } from './tools/tool';
import { UserPrefs } from './user-prefs';

const CULL_MARGIN_PX = 128;

export function cullMarginWorld(zoom: number): number {
  return zoom > 0 && Number.isFinite(zoom)
    ? CULL_MARGIN_PX / zoom
    : Number.POSITIVE_INFINITY;
}

export class CanvasRenderer {
  readonly ctx: WebGLPainter;
  private background: BackgroundRenderer | null = null;
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = new WebGLPainter(canvas);
  }

  setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.background?.destroy();
    this.background = new BackgroundRenderer(canvas);
  }

  redraw(
    deltaTime: number,
    viewport: CanvasViewport,
    elements: DrawableElement[],
    editingElement: DrawableElement | null,
    toolSelected: ITool,
    screenPosition: Vector2,
    placementController: PlacementController,
    domOverlayHost: HTMLElement | null,
  ): void {
    if (this.destroyed) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) {
      return;
    }
    const { zoom, offset } = viewport;
    this.background?.draw(
      width,
      height,
      dpr,
      zoom,
      offset.x,
      offset.y,
      UserPrefs.get('canvasBackground'),
      getCanvasPalette().grid,
    );

    const ctx = this.ctx;
    if (ctx.beginFrame(width, height, dpr)) {
      ctx.scale(zoom, zoom);
      ctx.translate(offset.x, offset.y);
      const viewRect = viewport.getWorldRect();
      const margin = cullMarginWorld(zoom);
      for (const element of elements) {
        if (element.intersectsWorldRect(viewRect, margin)) {
          element.draw(ctx, deltaTime);
        }
      }
      for (const element of elements) {
        if (element.hasSelectionOverlay) {
          element.drawSelectionOverlay(ctx, element === editingElement);
        }
      }
      const mouseWorld = viewport.screenToWorld(screenPosition);
      if (placementController.isActive) {
        placementController.drawGhost(ctx, mouseWorld);
      } else {
        toolSelected.drawCursor(ctx, mouseWorld);
      }
      ctx.endFrame();
    }

    if (domOverlayHost) {
      for (const element of elements) {
        element.syncDOM(viewport, domOverlayHost);
      }
      reorderDomOverlay(domOverlayHost, elements);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.background?.destroy();
    this.ctx.destroy();
  }
}

function reorderDomOverlay(
  host: HTMLElement,
  elements: DrawableElement[],
): void {
  const nodes = new Map<string, Element>();
  for (const child of host.children) {
    const uuid = (child as HTMLElement).dataset.elementUuid;
    if (uuid) {
      nodes.set(uuid, child);
    }
  }
  if (nodes.size < 2) {
    return;
  }

  let prev: Element | null = null;
  for (const element of elements) {
    const node = nodes.get(element.uuid);
    if (!node) {
      continue;
    }
    const expected: Element | null = prev
      ? prev.nextElementSibling
      : host.firstElementChild;
    if (node !== expected) {
      host.insertBefore(node, expected);
    }
    prev = node;
  }
}
