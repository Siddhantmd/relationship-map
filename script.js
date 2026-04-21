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

  // -------------------- SIMULATION --------------------
  const simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.links).id(d => d.id).distance(280).strength(0.1))
    .force("charge", d3.forceManyBody().strength(-900))
    .force("center", d3.forceCenter(700, 450))
    .force("collision", d3.forceCollide().radius(110))
    .velocityDecay(0.8)
    .alphaDecay(0.02);
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

  // -------------------- CONTROLS --------------------
  const zoomSlider = document.getElementById("zoom-slider");
  const resetZoomBtn = document.getElementById("reset-zoom");
  const hideIndirectCheckbox = document.getElementById("hide-indirect");

  function updateLinkVisibility() {
    const hideIndirect = hideIndirectCheckbox.checked;
    const path = currentHovered ? getPath(currentHovered, "p0") : null;
    links.style("opacity", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return 0;
      if (currentHovered) {
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return inPath ? 1 : 0.2;
      }
      return 1;
    })
    .style("stroke-width", d => {
      if (currentHovered) {
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return inPath ? 3 : 1;
      }
      return 1;    })
    .style("filter", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return "none";
      if (currentHovered) {
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return inPath ? "none" : "blur(1px)";
      }
      return "none";    })
    .style("filter", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return "none"; // since opacity 0, no need blur
      if (currentHovered) {
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return inPath ? "none" : "blur(1px)";
      }
      return "none";
    });
    linkLabelGroups.style("opacity", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return 0;
      if (currentHovered) {
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return inPath ? 1 : 0.2;
      }
      return 1;
    })
    .style("filter", d => {
      const isDirect = d.source.id === "p0" || d.target.id === "p0";
      if (hideIndirect && !isDirect) return "none";
      if (currentHovered) {
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return inPath ? "none" : "blur(4px)";
      }
      return "none";
    });
    nodes.style("opacity", d => {
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return 0;
      if (currentHovered) {
        return path.includes(d.id) ? 1 : 0.2;
      }
      return 1;
    })
    .style("pointer-events", d => {
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return "none";
      return "auto";
    })
    .style("filter", d => {
      const isDirect = d.id === "p0" || adj["p0"].includes(d.id);
      if (hideIndirect && !isDirect) return "none";
      if (currentHovered) {
        return path.includes(d.id) ? "none" : "blur(4px)";
      }
      return "none";
    });
  }

  zoomSlider.addEventListener("input", () => {
    const scale = +zoomSlider.value;
    svg.transition().call(zoom.scaleTo, scale);
  });

  resetZoomBtn.addEventListener("click", () => {
    svg.transition().call(zoom.transform, d3.zoomIdentity);
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
      currentHovered = d.id;
      updateLinkVisibility();
    })
    .on("mouseout", function() {
      currentHovered = null;
      updateLinkVisibility();
    });

  // Rectangles
  nodes.append("rect")
    .attr("width", 150)
    .attr("height", 40)
    .attr("x", -75)
    .attr("y", -20)
    .attr("rx", 6)
    .attr("fill", d => {
      if (d.degree === 0) return "#ffffcc";
      if (d.type === "person") return "#ffccff";
      return "#ccffff";
    });

  // Text line 1 (bold name)
  nodes.append("text")
    .attr("text-anchor", "middle")
    .attr("y", -5)
    .style("font-weight", "bold")
    .style("font-size", "11px")
    .text(d => d.name);

  // Text line 2
  nodes.append("text")
    .attr("text-anchor", "middle")
    .attr("y", 12)
    .style("font-size", "10px")
    .text(d => {
      if (d.title) {
        return d.organization ? `${d.title}, ${d.organization}` : d.title;
      }
      return d.otherInfo || "";
    });

  // -------------------- ZOOM --------------------
  const zoom = d3.zoom()
    .scaleExtent([0.1, 3])
    .on("zoom", (event) => {
      graph.attr("transform", event.transform);
    });

  svg.call(zoom);

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
  });

  // Start the simulation
  simulation.alpha(0.5).restart();

  // -------------------- DRAG --------------------
  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}