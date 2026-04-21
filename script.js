// -------------------- LOAD DATA --------------------
let data;

const xhr = new XMLHttpRequest();
xhr.open('GET', 'data.json', true);
xhr.onreadystatechange = function() {
  if (xhr.readyState === 4) {
    if (xhr.status === 200) {
      data = JSON.parse(xhr.responseText);
      console.log('Data loaded successfully:', data.nodes.length, 'nodes,', data.links.length, 'links');
      initVisualization();
    } else {
      console.error('Error loading data:', xhr.status);
    }
  }
};
xhr.send();

// -------------------- INITIALIZE VISUALIZATION --------------------
function initVisualization() {
  const NODE_WIDTH = 150;
  const NODE_MIN_HEIGHT = 44;
  const NODE_VERTICAL_PADDING = 8;
  const NODE_TEXT_GAP = 3;
  const NODE_TEXT_MAX_WIDTH = NODE_WIDTH - 16;
  // Circumscribed half-diagonal of the largest plausible node box + gap (graph coords).
  const NODE_COLLISION_RADIUS =
    Math.hypot(NODE_WIDTH / 2 + 12, NODE_MIN_HEIGHT / 2 + NODE_VERTICAL_PADDING + 26) + 14;

  function applyTruncatedText(textSelection, getFullText, maxWidth) {
    textSelection.each(function(d) {
      const textEl = d3.select(this);
      const fullText = (getFullText(d) || "").toString();

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

  function applyTwoLineClampedText(textSelection, getFullText, maxWidth) {
    textSelection.each(function(d) {
      const textEl = d3.select(this);
      const fullText = (getFullText(d) || "").toString().trim();

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

  // -------------------- ADJACENCY LIST --------------------
  const adj = {};
  data.nodes.forEach(n => adj[n.id] = []);
  data.links.forEach(l => {
    adj[l.source].push(l.target);
    adj[l.target].push(l.source);
  });

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

  window.addEventListener("mouseup", resetInteractionCursorState);
  window.addEventListener("pointerup", resetInteractionCursorState);
  window.addEventListener("blur", resetInteractionCursorState);

  updateCanvasCursor();

  function getClusterKey(node) {
    return node.organization || node.name || node.id;
  }

  function buildClusterCenters(nodes, width, height, spreadScale) {
    const clusterKeys = Array.from(new Set(nodes.map(getClusterKey)));
    const centers = new Map();
    const centerX = width / 2;
    const centerY = height / 2;
    const ringRadius = 280 * spreadScale;

    clusterKeys.forEach((clusterKey, index) => {
      const angle = (index / Math.max(1, clusterKeys.length)) * Math.PI * 2;
      centers.set(clusterKey, {
        x: centerX + ringRadius * Math.cos(angle),
        y: centerY + ringRadius * Math.sin(angle)
      });
    });

    return centers;
  }

  function createClusterForce(clusterCenters, k = 0.14) {
    let nodes = [];
    function force(alpha) {
      nodes.forEach(d => {
        if (d.degree === 0) return;
        const center = clusterCenters.get(getClusterKey(d));
        if (!center) return;
        d.vx += (center.x - d.x) * k * alpha;
        d.vy += (center.y - d.y) * k * alpha;
      });
    }
    force.initialize = (initNodes) => {
      nodes = initNodes;
    };
    return force;
  }

  // -------------------- SIMULATION --------------------
  const LAYOUT_SPREAD_SCALE = 2;
  const viewBox = svg.node().viewBox?.baseVal;
  const width = viewBox && viewBox.width ? viewBox.width : 1400;
  const height = viewBox && viewBox.height ? viewBox.height : 900;
  const clusterCenters = buildClusterCenters(data.nodes, width, height, LAYOUT_SPREAD_SCALE);
  const degreeZeroNode = data.nodes.find(n => n.degree === 0);
  if (degreeZeroNode) {
    degreeZeroNode.fx = width / 2;
    degreeZeroNode.fy = height / 2;
  }

  const simulation = d3.forceSimulation(data.nodes)
    .force(
      "link",
      d3.forceLink(data.links)
        .id(d => d.id)
        .distance(d => {
          const sourceDegree = d.source.degree ?? 2;
          if (sourceDegree === 0) return 220 * LAYOUT_SPREAD_SCALE;
          if (sourceDegree === 1) return 120 * LAYOUT_SPREAD_SCALE;
          return 80 * LAYOUT_SPREAD_SCALE;
        })
        .strength(d => (getClusterKey(d.source) === getClusterKey(d.target) ? 1 : 0.2))
    )
    .force("charge", d3.forceManyBody().strength(-380))
    .force(
      "radial",
      d3.forceRadial(
        d => {
          if (d.degree === 0) return 0;
          if (d.degree === 1) return 220 * LAYOUT_SPREAD_SCALE;
          return 380 * LAYOUT_SPREAD_SCALE;
        },
        width / 2,
        height / 2
      ).strength(0.8)
    )
    .force("cluster", createClusterForce(clusterCenters, 0.14))
    .force("center", d3.forceCenter(width / 2, height / 2).strength(0.03))
    .force(
      "collision",
      d3.forceCollide()
        .radius(() => NODE_COLLISION_RADIUS)
        .iterations(5)
    )
    .velocityDecay(0.8)
    .alphaDecay(0.03);
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
  let hasInitiallyCenteredPrimary = false;
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
  }

  zoomSlider.addEventListener("input", () => {
    const scale = +zoomSlider.value;
    svg.transition().call(zoom.scaleTo, scale);
  });

  resetZoomBtn.addEventListener("click", () => {
    centerPrimaryNode(1, true);
  });

  hideIndirectCheckbox.addEventListener("change", updateLinkVisibility);

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
  setGroupTitle(nodes, d => `${d.name}\n${getNodeSubText(d)}`.trim());

  // Rectangles
  const nodeRects = nodes.append("rect")
    .attr("class", "node-box")
    .attr("width", NODE_WIDTH)
    .attr("height", NODE_MIN_HEIGHT)
    .attr("x", -NODE_WIDTH / 2)
    .attr("y", -NODE_MIN_HEIGHT / 2)
    .attr("rx", 6)
    .attr("fill", d => {
      if (d.degree === 0) return "#ffffcc";
      if (d.type === "person") return "#ffccff";
      return "#ccffff";
    });

  // Text line 1 (bold name)
  const nameText = nodes.append("text")
    .attr("class", "node-name")
    .attr("text-anchor", "middle")
    .attr("y", 0)
    .style("font-weight", "bold")
    .style("font-size", "11px");
  applyTruncatedText(nameText, d => d.name, NODE_TEXT_MAX_WIDTH);

  // Text line 2
  const subText = nodes.append("text")
    .attr("class", "node-subtext")
    .attr("text-anchor", "middle")
    .attr("y", 0)
    .style("font-size", "10px");
  applyTwoLineClampedText(subText, getNodeSubText, NODE_TEXT_MAX_WIDTH);

  function layoutNodeContent() {
    nodes.each(function() {
      const nodeGroup = d3.select(this);
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

      const nodeHeight = Math.max(NODE_MIN_HEIGHT, contentHeight + (2 * NODE_VERTICAL_PADDING));
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
      graph.attr("transform", event.transform);
    })
    .on("end", (event) => {
      if (event.sourceEvent?.type === "mousedown") {
        isPanning = false;
      }
      updateCanvasCursor();
    });

  svg.call(zoom);

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
}