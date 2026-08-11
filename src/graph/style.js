class GraphStyleManager {
  constructor(cache) {
    this.cache = cache;
  }

  async resetStyleForSelectedElements() {
    // Get the current layout
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    if (!currentLayout) return;

    // Remove selected nodes from the current layout's custom styles
    for (const nodeId of this.cache.selectedNodes) {
      if (currentLayout.nodeStyles.has(nodeId)) {
        currentLayout.nodeStyles.delete(nodeId);
      }
    }

    // Remove selected edges from the current layout's custom styles
    for (const edgeId of this.cache.selectedEdges) {
      if (currentLayout.edgeStyles.has(edgeId)) {
        currentLayout.edgeStyles.delete(edgeId);
      }
    }

    // Reapply the layout to use the original default styles
    await this.cache.lm.changeLayout('Reset style of the selected elements');
    this.cache.history?.commit('Reset style');
  }

  async handleStyleChangeLoadingEvent(header, text) {
  await this.cache.ui.showLoading(header, text);
  await new Promise(resolve => requestAnimationFrame(resolve));
  this.cache.styleChanged = true;
  await this.cache.gcm.decideToRenderOrDraw();
  this.cache.ui.debug(`Graph updated after style event with message ${header} ${text}`);
}

  getNodeStyleOrDefaults(node) {
    const src = node.style ?? {};
    const d = this.cache.DEFAULTS.NODE;

    // ----- basic style -------------------------------------------------------
    /* @formatter:off */
  const defaultNode = {
    type : node.type ?? d.TYPE,
    style: {
      size         : src.size          ?? d.SIZE,
      fill         : src.fill          ?? d.FILL_COLOR,
      stroke       : src.stroke        ?? d.STROKE_COLOR,
      lineWidth    : src.lineWidth     ?? d.LINE_WIDTH,
      opacity      : src.opacity       ?? d.OPACITY,

      badge        : src.badge         ?? false,
      badges       : src.badges        ?? [],
      badgePalette : src.badgePalette  ?? [],
      badgeFontSize: src.badgeFontSize ?? d.BADGE.FONT_SIZE,
      badgeScaleWithNode: src.badgeScaleWithNode ?? d.BADGE.SCALE_WITH_NODE,
    }
  };

  // ----- label style ------------------------------------------------------
  if (!this.cache.CFG.HIDE_LABELS || src.label) {
    const l = this.cache.DEFAULTS.NODE.LABEL;

    Object.assign(defaultNode.style, {
      label                 : true,
      labelText             : src.labelText,
      labelBackgroundFill   : src.labelBackgroundFill   ?? l.BACKGROUND_COLOR,
      labelBackground       : src.labelBackground       ?? l.BACKGROUND,
      labelBackgroundRadius : src.labelBackgroundRadius ?? l.BACKGROUND_RADIUS,
      labelCursor           : src.labelCursor           ?? l.CURSOR,
      labelFill             : src.labelFill             ?? l.FOREGROUND_COLOR,
      labelFontSize         : src.labelFontSize         ?? l.FONT_SIZE,
      labelLeading          : src.labelLeading          ?? l.LINE_SPACING,
      labelMaxLines         : src.labelMaxLines         ?? l.MAX_LINES,
      labelMaxWidth         : src.labelMaxWidth         ?? l.MAX_WIDTH,
      labelOffsetX          : src.labelOffsetX          ?? l.OFFSET_X,
      labelOffsetY          : src.labelOffsetY          ?? l.OFFSET_Y,
      labelPadding          : src.labelPadding          ?? l.PADDING,
      labelPlacement        : src.labelPlacement        ?? l.PLACEMENT,
      labelTextAlign        : src.labelTextAlign        ?? l.TEXT_ALIGN,
      labelWordWrap         : src.labelWordWrap         ?? l.WORD_WRAP,
      labelZIndex           : src.labelZIndex           ?? l.Z_INDEX,
    });
  }
  /* @formatter:on */

    return defaultNode;
  }

  getEdgeStyleOrDefaults(edge) {
    const src = edge.style ?? {};
    const d = this.cache.DEFAULTS.EDGE;

    // ---- core edge style ----------------------------------------------------
    /* @formatter:off */
  const defaultEdge = {
    type : edge.type ?? d.TYPE,
    style: {
      startArrow           : src.startArrow           ?? d.ARROWS.START,
      startArrowSize       : src.startArrowSize       ?? d.ARROWS.START_SIZE,
      startArrowType       : src.startArrowType       ?? d.ARROWS.START_TYPE,
      startArrowColor      : src.startArrowColor      ?? d.ARROWS.START_COLOR,
      startArrowBorderColor: src.startArrowBorderColor?? d.ARROWS.START_BORDER_COLOR,
      startArrowBorderSize : src.startArrowBorderSize ?? d.ARROWS.START_BORDER_SIZE,
      endArrow             : src.endArrow             ?? d.ARROWS.END,
      endArrowSize         : src.endArrowSize         ?? d.ARROWS.END_SIZE,
      endArrowType         : src.endArrowType         ?? d.ARROWS.END_TYPE,
      endArrowColor        : src.endArrowColor        ?? d.ARROWS.END_COLOR,
      endArrowBorderColor  : src.endArrowBorderColor  ?? d.ARROWS.END_BORDER_COLOR,
      endArrowBorderSize   : src.endArrowBorderSize   ?? d.ARROWS.END_BORDER_SIZE,

      lineWidth      : src.lineWidth      ?? d.LINE_WIDTH,
      lineDash       : src.lineDash       ?? d.LINE_DASH,
      stroke         : src.stroke         ?? d.COLOR,
      opacity        : src.opacity        ?? d.OPACITY,

      halo           : src.halo           ?? d.HALO.ENABLED,
      haloStroke     : src.haloStroke     ?? d.HALO.COLOR,
      haloLineWidth  : src.haloLineWidth  ?? d.HALO.WIDTH,

      flow           : src.flow           ?? d.FLOW.ENABLED,
      flowType       : src.flowType       ?? d.FLOW.TYPE,
      flowSpeed      : src.flowSpeed      ?? d.FLOW.SPEED,
      flowStroke     : src.flowStroke     ?? d.FLOW.COLOR,
      flowOpacity    : src.flowOpacity    ?? d.FLOW.OPACITY,
      flowDensity    : src.flowDensity    ?? d.FLOW.DENSITY,
    }
  };

  // ---- label style ------------------------------------------------------
  if (!this.cache.CFG.HIDE_LABELS || src.label) {
    const l = this.cache.DEFAULTS.EDGE.LABEL;

    Object.assign(defaultEdge.style, {
      label                        : true,
      labelAutoRotate              : src.labelAutoRotate              ?? l.AUTO_ROTATE,
      labelBackground              : src.labelBackground              ?? l.BACKGROUND,
      labelBackgroundFill          : src.labelBackgroundFill          ?? l.BACKGROUND_COLOR,
      labelBackgroundCursor        : src.labelBackgroundCursor        ?? l.BACKGROUND_CURSOR,
      labelBackgroundFillOpacity   : src.labelBackgroundFillOpacity   ?? l.BACKGROUND_FILL_OPACITY,
      labelBackgroundRadius        : src.labelBackgroundRadius        ?? l.BACKGROUND_RADIUS,
      labelBackgroundStrokeOpacity : src.labelBackgroundStrokeOpacity ?? l.BACKGROUND_STROKE_OPACITY,
      labelCursor                  : src.labelCursor                  ?? l.CURSOR,
      labelFill                    : src.labelFill                    ?? l.FOREGROUND_COLOR,
      labelFillOpacity             : src.labelFillOpacity             ?? l.FILL_OPACITY,
      labelFontSize                : src.labelFontSize                ?? l.FONT_SIZE,
      labelFontWeight              : src.labelFontWeight              ?? l.FONT_WEIGHT,
      labelMaxLines                : src.labelMaxLines                ?? l.MAX_LINES,
      labelMaxWidth                : src.labelMaxWidth                ?? l.MAX_WIDTH,
      labelOffsetX                 : src.labelOffsetX                 ?? l.OFFSET_X,
      labelOffsetY                 : src.labelOffsetY                 ?? l.OFFSET_Y,
      labelOpacity                 : src.labelOpacity                 ?? l.OPACITY,
      labelPlacement               : src.labelPlacement               ?? l.PLACEMENT,
      labelPadding                 : src.labelPadding                 ?? l.PADDING,
      labelText                    : src.labelText                    ?? l.TEXT,
      labelTextAlign               : src.labelTextAlign               ?? l.TEXT_ALIGN,
      labelTextBaseLine            : src.labelTextBaseLine            ?? l.TEXT_BASE_LINE,
      labelTextOverflow            : src.labelTextOverflow            ?? l.TEXT_OVERFLOW,
      labelVisibility              : src.labelVisibility              ?? l.VISIBILITY,
      labelWordWrap                : src.labelWordWrap                ?? l.WORD_WRAP,
    });
    /* @formatter:on */
  }

    return defaultEdge;
  }
}

export {GraphStyleManager};