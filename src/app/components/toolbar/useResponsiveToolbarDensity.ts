import { useLayoutEffect, useRef } from "react";
import {
  chooseToolbarDensity,
  DEFAULT_TOOLBAR_FIT_BUFFER_PX,
  TOOLBAR_DENSITIES,
  type ToolbarDensity
} from "../../toolbarDensity";

// Measures the view-toolbar against each density tier and stamps the tightest
// one that still fits onto `data-density`, which the container queries in
// global.css read to show/hide labels, captions, and the full-vs-compact
// cluster pickers. Returns the ref the toolbar wrapper must carry.
export function useResponsiveToolbarDensity(measurementKey: string) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    let frameId: number | null = null;
    let disposed = false;

    const requiredGroupWidth = (group: HTMLElement) => {
      const style = window.getComputedStyle(group);
      const children = Array.from(group.children).filter(
        (child) => window.getComputedStyle(child).display !== "none"
      );
      const childrenWidth = children.reduce((total, child) => {
        const element = child as HTMLElement;
        const childStyle = window.getComputedStyle(element);
        return (
          total +
          element.getBoundingClientRect().width +
          (Number.parseFloat(childStyle.marginLeft) || 0) +
          (Number.parseFloat(childStyle.marginRight) || 0)
        );
      }, 0);
      const gap = Number.parseFloat(style.columnGap) || 0;
      return (
        childrenWidth +
        Math.max(0, children.length - 1) * gap +
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0)
      );
    };

    const requiredToolbarWidth = () => {
      const style = window.getComputedStyle(toolbar);
      const groups = Array.from(toolbar.children) as HTMLElement[];
      const gap = Number.parseFloat(style.columnGap) || 0;
      return (
        groups.reduce((total, group) => total + requiredGroupWidth(group), 0) +
        Math.max(0, groups.length - 1) * gap +
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0)
      );
    };

    const measure = () => {
      frameId = null;
      if (disposed || toolbar.clientWidth === 0) return;

      // Always try the richest layout first. Reading scrollWidth after each
      // density change forces the browser to evaluate that exact rendered
      // configuration, so panes, labels, fonts, and active view controls all
      // contribute to the breakpoint instead of relying on a guessed width.
      const requiredWidths = {} as Record<ToolbarDensity, number>;
      for (const density of TOOLBAR_DENSITIES) {
        toolbar.dataset.density = density;
        requiredWidths[density] = requiredToolbarWidth();
      }
      const nextDensity = chooseToolbarDensity(
        toolbar.clientWidth,
        requiredWidths,
        DEFAULT_TOOLBAR_FIT_BUFFER_PX
      );
      toolbar.dataset.density = nextDensity;
    };

    const scheduleMeasure = () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      if (typeof window.requestAnimationFrame === "function") {
        frameId = window.requestAnimationFrame(measure);
      } else {
        measure();
      }
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(toolbar);
    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleMeasure();
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [measurementKey]);

  return toolbarRef;
}
