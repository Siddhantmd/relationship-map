// -------------------- DATA SOURCE + LAYOUT DEFAULTS --------------------
const DATA_SOURCE_FILES = {
  "1": "data.json",
  "2": "data2.json",
  "3": "data3.json",
  "4": "data4.json",
  "5": "data5.json"
};

let activeSimulation = null;
let mountAbortController = null;
let dataLoadGeneration = 0;
let visualizationMountCount = 0;
let preservedZoomTransform = d3.zoomIdentity;

function snapshotLayoutDefaultsFromInputs() {
  const panel = document.getElementById("layout-panel");
  const defaults = {};
  if (!panel) return defaults;
  panel.querySelectorAll("input[data-layout-key]").forEach(input => {
    const key = input.dataset.layoutKey;
    defaults[key] =
      key === "collisionIterations" ? parseInt(input.defaultValue, 10) : parseFloat(input.defaultValue);
  });
  return defaults;
}

const LAYOUT_DEFAULTS = snapshotLayoutDefaultsFromInputs();

function loadDataSource(key) {
  const file = DATA_SOURCE_FILES[key];
  if (!file) return;
  const generation = ++dataLoadGeneration;
  fetch(file)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(json => {
      if (generation !== dataLoadGeneration) return;
      console.log("Data loaded:", file, json.nodes.length, "nodes,", json.links.length, "links");
      mountVisualization(json);
    })
    .catch(err => console.error("Error loading data:", err));
}

// -------------------- MOUNT / REMOUNT VISUALIZATION --------------------
function mountVisualization(data) {
  visualizationMountCount += 1;
  const isRemount = visualizationMountCount > 1;

  if (mountAbortController) mountAbortController.abort();
  mountAbortController = new AbortController();
  const signal = mountAbortController.signal;

  if (activeSimulation) {
    activeSimulation.stop();
    activeSimulation = null;
  }
  d3.select("svg g#graph").remove();
  d3.select("svg").on(".zoom", null);
  const NODE_WIDTH = 150;
  const NODE_MIN_HEIGHT = 44;
  const NODE_VERTICAL_PADDING = 8;
  const PRIMARY_NODE_EXTRA_VERTICAL_PAD = 10;
  const PRIMARY_NODE_TEXT_H_INSET = 12;
  const PRIMARY_NODE_MIN_HEIGHT = NODE_MIN_HEIGHT + 14;
  const NODE_TEXT_GAP = 3;
  const NODE_TEXT_MAX_WIDTH = NODE_WIDTH - 16;
  const NODE_TEXT_MAX_WIDTH_PRIMARY = NODE_WIDTH - 2 * PRIMARY_NODE_TEXT_H_INSET;
  // Circumscribed half-diagonal of the largest plausible node box + gap (graph coords).
  const NODE_COLLISION_RADIUS =
    Math.hypot(
      NODE_WIDTH / 2 + 12,
      PRIMARY_NODE_MIN_HEIGHT / 2 + NODE_VERTICAL_PADDING + PRIMARY_NODE_EXTRA_VERTICAL_PAD + 26
    ) + 14;

  function resolveMaxWidth(maxWidthOrFn, d) {
    return typeof maxWidthOrFn === "function" ? maxWidthOrFn(d) : maxWidthOrFn;
  }

  function applyTruncatedText(textSelection, getFullText, maxWidthOrFn) {
    textSelection.each(function(d) {
      const textEl = d3.select(this);
      const fullText = (getFullText(d) || "").toString();
      const maxWidth = resolveMaxWidth(maxWidthOrFn, d);

      textEl.text(fullText);
      textEl.attr("title", fullText);

      let titleEl = textEl.select("title");
      if (titleEl.empty()) {
        titleEl = textEl.append("title");
      }
      titleEl.text(fullText);

      if (this.getComputedTextLength() <= maxWidth) {
        return;
      }

      let lo = 0;
      let hi = fullText.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        textEl.text(`${fullText.slice(0, mid)}...`);
        if (this.getComputedTextLength() <= maxWidth) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      textEl.text(`${fullText.slice(0, lo)}...`);
    });
  }

  function getNodeSubText(d) {
    if (d.title) {
      return d.organization ? `${d.title}, ${d.organization}` : d.title;
    }
    return d.otherInfo || "";
  }

  function setGroupTitle(selection, getTitleText) {
    selection.each(function(d) {
      const group = d3.select(this);
      const fullText = (getTitleText(d) || "").toString();
      let titleEl = group.select("title");
      if (titleEl.empty()) {
        titleEl = group.append("title");
      }
      titleEl.text(fullText);
    });
  }

  function applyTwoLineClampedText(textSelection, getFullText, maxWidthOrFn) {
    textSelection.each(function(d) {
      const textEl = d3.select(this);
      const fullText = (getFullText(d) || "").toString().trim();
      const maxWidth = resolveMaxWidth(maxWidthOrFn, d);

      textEl.attr("title", fullText);
      let titleEl = textEl.select("title");
      if (titleEl.empty()) {
        titleEl = textEl.append("title");
      }
      titleEl.text(fullText);

      textEl.selectAll("tspan").remove();
      if (!fullText) return;

      const measureTspan = textEl.append("tspan").attr("x", 0).text("");
      const measureWidth = (value) => {
        measureTspan.text(value);
        return measureTspan.node().getComputedTextLength();
      };

      const clampWithEllipsis = (value) => {
        if (measureWidth(value) <= maxWidth) return value;
        let lo = 0;
        let hi = value.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          const candidate = `${value.slice(0, mid)}...`;
          if (measureWidth(candidate) <= maxWidth) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        return `${value.slice(0, lo)}...`;
      };

      const words = fullText.split(/\s+/).filter(Boolean);
      let line1 = "";
      let index = 0;

      while (index < words.length) {
        const candidate = line1 ? `${line1} ${words[index]}` : words[index];
        if (!line1 || measureWidth(candidate) <= maxWidth) {
          line1 = candidate;
          index += 1;
        } else {
          break;
        }
      }

      if (!line1) {
        line1 = clampWithEllipsis(fullText);
      }

      let line2 = "";
      if (index < words.length) {
        line2 = clampWithEllipsis(words.slice(index).join(" "));
      }

      measureTspan.remove();

      textEl.append("tspan")
        .attr("x", 0)
        .attr("dy", 0)
        .text(line1);

      if (line2) {
        textEl.append("tspan")
          .attr("x", 0)
          .attr("dy", "1.1em")
          .text(line2);
      }
    });
  }

  const PRIMARY_NODE_ID = "p0";

  function buildHopFromPrimary(adjacency, primaryId) {
    const hop = new Map();
    const queue = [primaryId];
    hop.set(primaryId, 0);
    while (queue.length) {
      const u = queue.shift();
      const dist = hop.get(u);
      for (const v of adjacency[u] || []) {
        if (!hop.has(v)) {
          hop.set(v, dist + 1);
          queue.push(v);
        }
      }
    }
    return hop;
  }

  // -------------------- ADJACENCY LIST --------------------
  const adj = {};
  data.nodes.forEach(n => adj[n.id] = []);
  data.links.forEach(l => {
    adj[l.source].push(l.target);
    adj[l.target].push(l.source);
  });

  const hopFromPrimaryMap = buildHopFromPrimary(adj, PRIMARY_NODE_ID);

  function linkTargetHops(link) {
    if (typeof link.degree === "number") return link.degree;
    const tid = typeof link.target === "object" && link.target !== null ? link.target.id : link.target;
    return hopFromPrimaryMap.get(tid) ?? 0;
  }

  // -------------------- SVG --------------------
  const svg = d3.select("svg");
  const graph = svg.append("g").attr("id", "graph");
  let isNodeDragging = false;
  let isPanning = false;

  function updateCanvasCursor() {
    if (isNodeDragging || isPanning) {
      svg.style("cursor", "grabbing");
      return;
    }
    svg.style("cursor", "default");
  }

  function resetInteractionCursorState() {
    isNodeDragging = false;
    isPanning = false;
    updateCanvasCursor();
  }

  window.addEventListener("mouseup", resetInteractionCursorState, { signal });
  window.addEventListener("pointerup", resetInteractionCursorState, { signal });
  window.addEventListener("blur", resetInteractionCursorState, { signal });

  updateCanvasCursor();

  // -------------------- SIMULATION --------------------
  const viewBox = svg.node().viewBox?.baseVal;
  const width = viewBox && viewBox.width ? viewBox.width : 1400;
  const height = viewBox && viewBox.height ? viewBox.height : 900;
  const primaryNode = data.nodes.find(n => n.id === PRIMARY_NODE_ID);
  if (primaryNode) {
    primaryNode.fx = width / 2;
    primaryNode.fy = height / 2;
  }

  /** Tunable layout parameters (defaults match #layout-panel slider values). */
  const layoutConfig = {
    linkLengthBasePx: 400,
    linkStrength: 1,
    chargeStrength: -400,
    radialStrength: 5,
    radialRingSpacing: 400,
    centerStrength: 0.002,
    collisionRadiusFactor: 0.72,
    collisionIterations: 1,
    velocityDecay: 0.8,
    alphaDecay: 0.03
  };

  function readLayoutConfigFromPanel() {
    const panel = document.getElementById("layout-panel");
    if (!panel) return;
    panel.querySelectorAll("input[data-layout-key]").forEach(input => {
      const key = input.dataset.layoutKey;
      if (key === "collisionIterations") {
        layoutConfig[key] = parseInt(input.value, 10);
      } else {
        layoutConfig[key] = parseFloat(input.value);
      }
    });
  }

  function formatLayoutValue(key, v) {
    if (key === "collisionIterations") return String(v);
    if (key === "chargeStrength" || key === "linkLengthBasePx" || key === "radialRingSpacing") {
      return String(Math.round(v));
    }
    if (key === "radialStrength") {
      return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
    }
    const s = v.toFixed(4);
    return s.replace(/\.?0+$/, "");
  }

  function updateLayoutValueLabels() {
    const panel = document.getElementById("layout-panel");
    if (!panel) return;
    panel.querySelectorAll("input[data-layout-key]").forEach(input => {
      const key = input.dataset.layoutKey;
      const span = document.getElementById(`${input.id}-val`);
      if (span) span.textContent = formatLayoutValue(key, layoutConfig[key]);
    });
  }

  readLayoutConfigFromPanel();

  const simulation = d3.forceSimulation(data.nodes)
    .force(
      "link",
      d3.forceLink(data.links)
        .id(d => d.id)
        .distance(d => {
          const deg = Math.max(1, linkTargetHops(d));
          return layoutConfig.linkLengthBasePx / Math.pow(2, deg - 1);
        })
        .strength(layoutConfig.linkStrength)
    )
    .force("charge", d3.forceManyBody().strength(layoutConfig.chargeStrength))
    .force(
      "radial",
      d3.forceRadial(
        d => {
          if (d.id === PRIMARY_NODE_ID) return 0;
          const hop = hopFromPrimaryMap.get(d.id) ?? 1;
          return layoutConfig.radialRingSpacing * hop;
        },
        width / 2,
        height / 2
      ).strength(layoutConfig.radialStrength)
    )
    .force("center", d3.forceCenter(width / 2, height / 2).strength(layoutConfig.centerStrength))
    .force(
      "collision",
      d3.forceCollide()
        .radius(() => NODE_COLLISION_RADIUS * layoutConfig.collisionRadiusFactor)
        .iterations(Math.max(1, Math.round(layoutConfig.collisionIterations)))
    )
    .velocityDecay(layoutConfig.velocityDecay)
    .alphaDecay(layoutConfig.alphaDecay);

  function applyLayoutParams() {
    const linkF = simulation.force("link");
    if (linkF) {
      linkF.strength(layoutConfig.linkStrength);
      linkF.distance(d => {
        const deg = Math.max(1, linkTargetHops(d));
        return layoutConfig.linkLengthBasePx / Math.pow(2, deg - 1);
      });
    }
    const chargeF = simulation.force("charge");
    if (chargeF) chargeF.strength(layoutConfig.chargeStrength);
    const radialF = simulation.force("radial");
    if (radialF) radialF.strength(layoutConfig.radialStrength);
    const centerF = simulation.force("center");
    if (centerF) centerF.strength(layoutConfig.centerStrength);
    const collideF = simulation.force("collision");
    if (collideF) {
      collideF.radius(() => NODE_COLLISION_RADIUS * layoutConfig.collisionRadiusFactor);
      collideF.iterations(Math.max(1, Math.round(layoutConfig.collisionIterations)));
    }
    simulation.velocityDecay(layoutConfig.velocityDecay);
    simulation.alphaDecay(layoutConfig.alphaDecay);
    simulation.alpha(Math.max(simulation.alpha(), 0.28)).restart();
  }

  function resetLayoutParam(key) {
    if (!Object.prototype.hasOwnProperty.call(LAYOUT_DEFAULTS, key)) return;
    const v = LAYOUT_DEFAULTS[key];
    layoutConfig[key] = v;
    const panel = document.getElementById("layout-panel");
    if (!panel) return;
    const input = panel.querySelector(`input[data-layout-key="${key}"]`);
    if (input) input.value = String(v);
    updateLayoutValueLabels();
    applyLayoutParams();
  }

  function redrawLayoutFromPanel() {
    readLayoutConfigFromPanel();
    updateLayoutValueLabels();
    applyLayoutParams();
    const spreadX = width * 0.35;
    const spreadY = height * 0.35;
    for (const n of data.nodes) {
      if (n.id === PRIMARY_NODE_ID) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.fx = null;
      n.fy = null;
      n.x = width / 2 + (Math.random() - 0.5) * 2 * spreadX;
      n.y = height / 2 + (Math.random() - 0.5) * 2 * spreadY;
      n.vx = 0;
      n.vy = 0;
    }
    simulation.alpha(1).restart();
  }

  function bindLayoutPanel() {
    const panel = document.getElementById("layout-panel");
    if (!panel) return;
    readLayoutConfigFromPanel();
    updateLayoutValueLabels();
    panel.querySelectorAll("input[data-layout-key]").forEach(input => {
      input.addEventListener(
        "input",
        () => {
          const key = input.dataset.layoutKey;
          if (key === "collisionIterations") {
            layoutConfig[key] = parseInt(input.value, 10);
          } else {
            layoutConfig[key] = parseFloat(input.value);
          }
          const span = document.getElementById(`${input.id}-val`);
          if (span) span.textContent = formatLayoutValue(key, layoutConfig[key]);
          applyLayoutParams();
        },
        { signal }
      );
    });
    panel.querySelectorAll("button.layout-param-reset").forEach(btn => {
      btn.addEventListener(
        "click",
        () => {
          const key = btn.dataset.layoutKey;
          if (key) resetLayoutParam(key);
        },
        { signal }
      );
    });
    const redrawBtn = document.getElementById("layout-redraw");
    if (redrawBtn) redrawBtn.addEventListener("click", redrawLayoutFromPanel, { signal });
  }

  bindLayoutPanel();
  const links = graph.append("g")
    .selectAll("line")
    .data(data.links)
    .enter()
    .append("line")
    .attr("class", "link");

  // Link labels
  const linkLabelGroups = graph.append("g")
    .selectAll("g")
    .data(data.links)
    .enter()
    .append("g")
    .attr("class", "link-label-group");

  linkLabelGroups.append("rect")
    .attr("class", "link-label-bg")
    .attr("fill", "#f0f0f0")
    .attr("rx", 3)
    .attr("ry", 3);

  const linkLabels = linkLabelGroups.append("text")
    .attr("class", "link-label")
    .text(d => d.relationship);
  applyTruncatedText(linkLabels, d => d.relationship, 220);
  setGroupTitle(linkLabelGroups, d => d.relationship);

  // -------------------- CONTROLS --------------------
  const zoomSlider = document.getElementById("zoom-slider");
  const resetZoomBtn = document.getElementById("reset-zoom");
  const hideIndirectCheckbox = document.getElementById("hide-indirect");
  const visibilityTransitionDuration = 600;
  let hasInitiallyCenteredPrimary = isRemount;
  let initialCenteringTicks = 0;
  const MAX_INITIAL_CENTERING_TICKS = 60;

  function updateLinkVisibility() {
    const hideIndirect = hideIndirectCheckbox.checked;
    const path = currentHovered ? getPath(currentHovered, "p0") : null;
    const pathSet = path ? new Set(path) : null;
    const hoveredNeighbors = currentHovered ? new Set(adj[currentHovered] || []) : null;

    function isNodeHighlighted(nodeId) {
      if (!currentHovered) return true;
      return pathSet.has(nodeId) || hoveredNeighbors.has(nodeId);
    }

    function isLinkHighlighted(link) {
      if (!currentHovered) return true;
      const sourceId = link.source.id;
      const targetId = link.target.id;
      const inPath = pathSet.has(sourceId) && pathSet.has(targetId);
      const touchesHovered = sourceId === currentHovered || targetId === currentHovered;
      return inPath || touchesHovered;
    }

    function isNodeInFocus(d) {
      if (!currentHovered) return false;
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return false;
      return isNodeHighlighted(d.id);
    }

    links
    .interrupt()
    .transition()
    .duration(visibilityTransitionDuration)
    .style("opacity", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return 0;
      if (currentHovered) {
        return isLinkHighlighted(d) ? 1 : 0.2;
      }
      return 1;
    })
    .style("stroke-width", d => {
      if (currentHovered) {
        return isLinkHighlighted(d) ? 3 : 1;
      }
      return 1;    })
    .style("filter", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return "none";
      if (currentHovered) {
        return isLinkHighlighted(d) ? "none" : "blur(1px)";
      }
      return "none";    })
    .style("filter", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return "none"; // since opacity 0, no need blur
      if (currentHovered) {
        return isLinkHighlighted(d) ? "none" : "blur(1px)";
      }
      return "none";
    });
    linkLabelGroups
    .interrupt()
    .transition()
    .duration(visibilityTransitionDuration)
    .style("opacity", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return 0;
      if (currentHovered) {
        return isLinkHighlighted(d) ? 1 : 0.2;
      }
      return 1;
    })
    .style("filter", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return "none";
      if (currentHovered) {
        return isLinkHighlighted(d) ? "none" : "blur(4px)";
      }
      return "none";
    });
    nodes
    .interrupt()
    .transition()
    .duration(visibilityTransitionDuration)
    .style("opacity", d => {
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return 0;
      if (currentHovered) {
        return isNodeHighlighted(d.id) ? 1 : 0.2;
      }
      return 1;
    });

    nodes
    .style("pointer-events", d => {
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return "none";
      return "auto";
    })
    .style("filter", d => {
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return "none";
      if (currentHovered) {
        return isNodeHighlighted(d.id) ? "none" : "blur(4px)";
      }
      return "none";
    });

    nodes.classed("node--focus", d => isNodeInFocus(d));
  }

  zoomSlider.addEventListener(
    "input",
    () => {
      const scale = +zoomSlider.value;
      svg.transition().call(zoom.scaleTo, scale);
    },
    { signal }
  );

  resetZoomBtn.addEventListener("click", () => centerPrimaryNode(1, true), { signal });

  hideIndirectCheckbox.addEventListener("change", updateLinkVisibility, { signal });

  // -------------------- PATH FINDING --------------------
  function getPath(start, end) {
    const queue = [start];
    const visited = new Set();
    const parent = {};
    visited.add(start);
    while (queue.length) {
      const curr = queue.shift();
      if (curr === end) break;
      adj[curr].forEach(neigh => {
        if (!visited.has(neigh)) {
          visited.add(neigh);
          parent[neigh] = curr;
          queue.push(neigh);
        }
      });
    }
    const path = [];
    let curr = end;
    while (curr) {
      path.push(curr);
      curr = parent[curr];
    }
    return path.reverse();
  }

  let currentHovered = null;

  // -------------------- NODES --------------------
  const nodes = graph.append("g")
    .selectAll("g")
    .data(data.nodes)
    .enter()
    .append("g")
    .attr("class", d => (d.id === PRIMARY_NODE_ID ? "node node--primary" : "node"))
    .call(d3.drag()
      .on("start", dragStarted)
      .on("drag", dragged)
      .on("end", dragEnded)
    )
    .on("mouseover", function(event, d) {
      if (d.id === "p0") {
        currentHovered = null;
      } else {
        currentHovered = d.id;
      }
      updateLinkVisibility();
    })
    .on("mouseout", function() {
      currentHovered = null;
      updateLinkVisibility();
    });
  const nodeInner = nodes.append("g").attr("class", "node-inner");
  setGroupTitle(nodes, d => `${d.name}\n${getNodeSubText(d)}`.trim());

  // Rectangles
  const nodeRects = nodeInner.append("rect")
    .attr("class", "node-box")
    .attr("width", NODE_WIDTH)
    .attr("height", NODE_MIN_HEIGHT)
    .attr("x", -NODE_WIDTH / 2)
    .attr("y", -NODE_MIN_HEIGHT / 2)
    .attr("rx", 6)
    .attr("fill", d => {
      if (d.id === PRIMARY_NODE_ID) return "#ffffcc";
      if (d.type === "person") return "#ffccff";
      return "#ccffff";
    });

  // Text line 1 (bold name)
  const nameText = nodeInner.append("text")
    .attr("class", "node-name")
    .attr("text-anchor", "middle")
    .attr("y", 0)
    .style("font-weight", "bold")
    .style("font-size", "11px");
  applyTruncatedText(
    nameText,
    d => d.name,
    d => (d.id === PRIMARY_NODE_ID ? NODE_TEXT_MAX_WIDTH_PRIMARY : NODE_TEXT_MAX_WIDTH)
  );

  // Text line 2
  const subText = nodeInner.append("text")
    .attr("class", "node-subtext")
    .attr("text-anchor", "middle")
    .attr("y", 0)
    .style("font-size", "10px");
  applyTwoLineClampedText(
    subText,
    getNodeSubText,
    d => (d.id === PRIMARY_NODE_ID ? NODE_TEXT_MAX_WIDTH_PRIMARY : NODE_TEXT_MAX_WIDTH)
  );

  function layoutNodeContent() {
    nodes.each(function(d) {
      const nodeGroup = d3.select(this).select(".node-inner");
      const box = nodeGroup.select("rect.node-box");
      const name = nodeGroup.select("text.node-name");
      const details = nodeGroup.select("text.node-subtext");

      const nameBox = name.node().getBBox();
      const detailsBox = details.node().getBBox();
      const hasDetails = details.text().trim().length > 0;

      const contentHeight = hasDetails
        ? nameBox.height + NODE_TEXT_GAP + detailsBox.height
        : nameBox.height;
      const topContentY = -contentHeight / 2;

      name.attr("y", topContentY - nameBox.y);

      if (hasDetails) {
        details.attr("y", topContentY + nameBox.height + NODE_TEXT_GAP - detailsBox.y);
      }

      const vPad =
        d.id === PRIMARY_NODE_ID ? NODE_VERTICAL_PADDING + PRIMARY_NODE_EXTRA_VERTICAL_PAD : NODE_VERTICAL_PADDING;
      const minBoxH = d.id === PRIMARY_NODE_ID ? PRIMARY_NODE_MIN_HEIGHT : NODE_MIN_HEIGHT;
      const nodeHeight = Math.max(minBoxH, contentHeight + 2 * vPad);
      box
        .attr("height", nodeHeight)
        .attr("y", -nodeHeight / 2);
    });
  }

  layoutNodeContent();

  // -------------------- ZOOM --------------------
  const zoom = d3.zoom()
    .scaleExtent([0.1, 3])
    .on("start", (event) => {
      if (!event.sourceEvent) return;
      if (event.sourceEvent.type === "mousedown") {
        isPanning = true;
        updateCanvasCursor();
      }
    })
    .on("zoom", (event) => {
      preservedZoomTransform = event.transform;
      graph.attr("transform", event.transform);
    })
    .on("end", (event) => {
      if (event.sourceEvent?.type === "mousedown") {
        isPanning = false;
      }
      updateCanvasCursor();
    });

  svg.call(zoom);
  if (isRemount) {
    svg.call(zoom.transform, preservedZoomTransform);
  }

  function centerPrimaryNode(scale = null, animate = false) {
    const primaryNode = data.nodes.find(n => n.id === "p0");
    if (!primaryNode || !Number.isFinite(primaryNode.x) || !Number.isFinite(primaryNode.y)) {
      return;
    }

    const currentTransform = d3.zoomTransform(svg.node());
    const targetScale = scale ?? currentTransform.k;
    const viewBox = svg.node().viewBox?.baseVal;
    const viewportWidth = viewBox && viewBox.width ? viewBox.width : svg.node().clientWidth;
    const viewportHeight = viewBox && viewBox.height ? viewBox.height : svg.node().clientHeight;
    const targetTransform = d3.zoomIdentity
      .translate(viewportWidth / 2, viewportHeight / 2)
      .scale(targetScale)
      .translate(-primaryNode.x, -primaryNode.y);

    if (animate) {
      svg.transition().call(zoom.transform, targetTransform);
    } else {
      svg.call(zoom.transform, targetTransform);
    }
  }

  // -------------------- TICK --------------------
  simulation.on("tick", () => {
    links
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    linkLabelGroups
      .attr("transform", d => `translate(${(d.source.x + d.target.x) / 2}, ${(d.source.y + d.target.y) / 2})`)
      .each(function(d) {
        const text = d3.select(this).select("text");
        const bbox = text.node().getBBox();
        d3.select(this).select("rect")
          .attr("x", bbox.x - 4)
          .attr("y", bbox.y - 2)
          .attr("width", bbox.width + 8)
          .attr("height", bbox.height + 4);
      });

    nodes
      .attr("transform", d => `translate(${d.x}, ${d.y})`);

    const primaryNode = data.nodes.find(n => n.id === "p0");
    if (
      !hasInitiallyCenteredPrimary &&
      primaryNode &&
      Number.isFinite(primaryNode.x) &&
      Number.isFinite(primaryNode.y)
    ) {
      // Keep the primary node centered while the initial simulation settles,
      // then stop recentering to preserve normal pan/zoom interactions.
      centerPrimaryNode(1, false);
      initialCenteringTicks += 1;
      if (initialCenteringTicks >= MAX_INITIAL_CENTERING_TICKS || simulation.alpha() < 0.12) {
        hasInitiallyCenteredPrimary = true;
      }
    }
  });

  // Start the simulation
  simulation.alpha(0.5).restart();

  // -------------------- DRAG --------------------
  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
    isNodeDragging = true;
    updateCanvasCursor();
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
    isNodeDragging = false;
    updateCanvasCursor();
  }

  activeSimulation = simulation;
}

const dataSourceSelect = document.getElementById("data-source");
if (dataSourceSelect) {
  dataSourceSelect.addEventListener("change", () => loadDataSource(dataSourceSelect.value));
}
loadDataSource(dataSourceSelect ? dataSourceSelect.value : "1");