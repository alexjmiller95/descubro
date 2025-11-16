"use client";

import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { SimulationNodeDatum } from "d3";

/* ============================================================
   TYPES
   ============================================================ */
export interface ArtistRecord extends SimulationNodeDatum {
  id: string;
  name: string;
  genre: string[];
  image: string | null;
  spotify: string | null;
  connections: string[];
}

export interface Link
  extends d3.SimulationLinkDatum<ArtistRecord> {
  source: string | ArtistRecord;
  target: string | ArtistRecord;
  sourceId: string;
  targetId: string;
  genre: string;
}

/* ============================================================
   CONFIG
   ============================================================ */

const NODE_RADIUS = 20; // 50% smaller than “big” version
const LINE_WIDTH = 2;   // 2× thicker than 1

const GENRE_FALLBACK_COLOR = "#888888";

/* ============================================================
   COMPONENT
   ============================================================ */
export default function Page() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const minimapRef = useRef<SVGSVGElement | null>(null);

  const [nodes, setNodes] = useState<ArtistRecord[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  /* ------------------------------------------------------------
      FETCH DATA
     ------------------------------------------------------------ */
  useEffect(() => {
    async function loadData() {
      // TODO: replace these with your actual endpoints if different
      const artistRes = await fetch("/api/get_artists");
      const artistJson: any[] = await artistRes.json();

      const connRes = await fetch("/api/get_connections");
      const connJson: any[] = await connRes.json();

      const artists: ArtistRecord[] = artistJson.map((a) => ({
        id: String(a.id ?? a._id),
        name: String(a.name ?? ""),
        genre: Array.isArray(a.genre) ? a.genre : [],
        image: typeof a.image_url === "string" ? a.image_url : null,
        spotify:
          typeof a.spotify_id === "string" ? a.spotify_id : null,
        connections: Array.isArray(a.connections)
          ? a.connections
          : [],
      }));

      const links: Link[] = connJson
        .filter(
          (c) =>
            typeof c.artist_1 === "string" &&
            typeof c.artist_2 === "string"
        )
        .map((c) => {
          const genre =
            (c.genre as string | undefined)?.toLowerCase() ??
            "unknown";
          const s = c.artist_1 as string;
          const t = c.artist_2 as string;
          return {
            source: s,
            target: t,
            sourceId: s,
            targetId: t,
            genre,
          };
        });

      setNodes(artists);
      setLinks(links);
    }

    loadData();
  }, []);

  /* ------------------------------------------------------------
      D3 FORCE GRAPH + INTERACTIONS
     ------------------------------------------------------------ */
  useEffect(() => {
    if (!svgRef.current || !minimapRef.current || !nodes.length)
      return;

    const svg = d3.select(svgRef.current);
    const minimapSvg = d3.select(minimapRef.current);

    svg.selectAll("*").remove();
    minimapSvg.selectAll("*").remove();

    const width = window.innerWidth;
    const height = window.innerHeight;

    const minimapWidth = 220;
    const minimapHeight = 220;
    const scaleX = minimapWidth / width;
    const scaleY = minimapHeight / height;

    svg
      .attr("width", width)
      .attr("height", height)
      .style("background", "black");

    minimapSvg
      .attr("width", minimapWidth)
      .attr("height", minimapHeight)
      .style("background", "rgba(10,10,10,0.9)");

    /* ========== Genre colour scale & clustering centres ======= */

    const primaryGenres = nodes.map((n) =>
      (n.genre[0] ?? "unknown").toLowerCase()
    );
    const uniqueGenres = Array.from(new Set(primaryGenres));

    const colorScale = d3
      .scaleOrdinal<string, string>(d3.schemeTableau10)
      .domain(uniqueGenres);

    const genreColor: Record<string, string> = {};
    uniqueGenres.forEach((g) => {
      genreColor[g] = colorScale(g);
    });

    const bandStep = width / (uniqueGenres.length + 1);
    const genreCenterX: Record<string, number> = {};
    uniqueGenres.forEach((g, i) => {
      genreCenterX[g] = bandStep * (i + 1);
    });

    /* ========== Tooltip ====================================== */

    const tooltip = d3
      .select("body")
      .append("div")
      .style("position", "absolute")
      .style("padding", "8px 12px")
      .style("background", "rgba(0,0,0,0.85)")
      .style("color", "#ffffff")
      .style("border-radius", "6px")
      .style("font-size", "12px")
      .style("font-family", "Afacad, sans-serif")
      .style("pointer-events", "none")
      .style("opacity", 0);

    /* ========== Main group with zoom transform =============== */

    const mainG = svg.append("g");

    /* ========== Image patterns for perfect circular nodes ==== */

    const defs = mainG.append("defs");

    nodes.forEach((n) => {
      if (!n.image) return;
      const pattern = defs
        .append("pattern")
        .attr("id", `img-${n.id}`)
        .attr("patternUnits", "objectBoundingBox")
        .attr("width", 1)
        .attr("height", 1);

      pattern
        .append("image")
        .attr("href", n.image)
        .attr("width", NODE_RADIUS * 2)
        .attr("height", NODE_RADIUS * 2)
        .attr("preserveAspectRatio", "xMidYMid slice");
    });

    /* ========== Build adjacency for highlight / hover ======== */

    const neighbors = new Map<string, Set<string>>();
    links.forEach((l) => {
      const s = l.sourceId;
      const t = l.targetId;
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(t)) neighbors.set(t, new Set());
      neighbors.get(s)!.add(t);
      neighbors.get(t)!.add(s);
    });

    /* ========== Links (main) ================================= */

    const linkSel = mainG
      .append("g")
      .attr("stroke-linecap", "round")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-width", LINE_WIDTH)
      .attr("stroke", (d) => genreColor[d.genre] ?? GENRE_FALLBACK_COLOR)
      .attr("stroke-opacity", 0.7);

    /* ========== Nodes (main) ================================= */

    const nodeSel = mainG
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d) =>
        d.image ? `url(#img-${d.id})` : "#444444"
      )
      .attr("stroke", (d) => {
        const g = (d.genre[0] ?? "unknown").toLowerCase();
        return genreColor[g] ?? "#ffffff";
      })
      .attr("stroke-width", 2)
      .style("cursor", "pointer");

    /* ========== Hover animation & tooltip ==================== */

    function highlightHover(d: ArtistRecord | null) {
      if (!d) {
        nodeSel
          .transition()
          .duration(150)
          .attr("r", NODE_RADIUS)
          .attr("stroke-width", 2)
          .attr("opacity", 1);

        linkSel
          .transition()
          .duration(150)
          .attr("stroke-opacity", 0.7);
        return;
      }

      const neigh = neighbors.get(d.id) ?? new Set<string>();

      nodeSel
        .transition()
        .duration(150)
        .attr("r", (n) =>
          n.id === d.id || neigh.has(n.id)
            ? NODE_RADIUS * 1.3
            : NODE_RADIUS * 0.9
        )
        .attr("opacity", (n) =>
          n.id === d.id || neigh.has(n.id) ? 1 : 0.3
        )
        .attr("stroke-width", (n) =>
          n.id === d.id ? 3 : 2
        );

      linkSel
        .transition()
        .duration(150)
        .attr("stroke-opacity", (l) =>
          l.sourceId === d.id || l.targetId === d.id ? 1 : 0.2
        );
    }

    nodeSel
      .on("mouseover", function (event, d) {
        highlightHover(d);
        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${d.name.toUpperCase()}</strong><br/>
             GENRES: ${d.genre.join(", ").toUpperCase()}<br/>
             CONNECTIONS: ${d.connections.length}`
          )
          .style("left", event.pageX + 14 + "px")
          .style("top", event.pageY + 14 + "px");
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", event.pageX + 14 + "px")
          .style("top", event.pageY + 14 + "px");
      })
      .on("mouseout", function () {
        tooltip.style("opacity", 0);
        highlightHover(null);
      });

    /* ========== Minimap ====================================== */

    const minimapG = minimapSvg.append("g");

    const miniLinks = minimapG
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-width", 1)
      .attr("stroke", (d) => genreColor[d.genre] ?? "#555")
      .attr("stroke-opacity", 0.7);

    const miniNodes = minimapG
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", NODE_RADIUS * scaleX * 0.9)
      .attr("fill", (d) =>
        d.image ? `url(#img-${d.id})` : "#777"
      )
      .attr("stroke", "#111")
      .attr("stroke-width", 1);

    const viewportRect = minimapSvg
      .append("rect")
      .attr("fill", "none")
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .attr("pointer-events", "none");

    let currentTransform = d3.zoomIdentity;

    function updateMinimapViewport() {
      const k = currentTransform.k;
      const tx = currentTransform.x;
      const ty = currentTransform.y;

      // visible region in main coords
      const x0 = (-tx) / k;
      const x1 = (width - tx) / k;
      const y0 = (-ty) / k;
      const y1 = (height - ty) / k;

      viewportRect
        .attr("x", x0 * scaleX)
        .attr("y", y0 * scaleY)
        .attr("width", (x1 - x0) * scaleX)
        .attr("height", (y1 - y0) * scaleY);
    }

    // click minimap to center
    minimapSvg.on("click", (event) => {
      const [mx, my] = d3.pointer(event);

      const targetX = mx / scaleX;
      const targetY = my / scaleY;

      const k = currentTransform.k;
      const newTransform = d3.zoomIdentity
        .translate(width / 2 - targetX * k, height / 2 - targetY * k)
        .scale(k);

      svg
        .transition()
        .duration(400)
        .call(zoomBehavior.transform as any, newTransform);
    });

    /* ========== Zoom + pan ================================== */

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        mainG.attr("transform", currentTransform.toString());
        updateMinimapViewport();
      });

    svg.call(zoomBehavior as any);
    updateMinimapViewport();

    /* ========== Force simulation (with genre clustering) ===== */

    const simulation = d3
      .forceSimulation<ArtistRecord>(nodes)
      .force(
        "link",
        d3
          .forceLink<ArtistRecord, Link>(links)
          .id((d) => d.id)
          .distance(130)
      )
      .force(
        "charge",
        d3.forceManyBody<ArtistRecord>().strength(-220)
      )
      .force(
        "x",
        d3.forceX<ArtistRecord>((d) => {
          const g = (d.genre[0] ?? "unknown").toLowerCase();
          return genreCenterX[g] ?? width / 2;
        }).strength(0.25)
      )
      .force(
        "y",
        d3.forceY<ArtistRecord>(height / 2).strength(0.06)
      )
      .force(
        "collision",
        d3.forceCollide<ArtistRecord>().radius(NODE_RADIUS * 2.2)
      )
      .on("tick", () => {
        linkSel
          .attr("x1", (d) =>
            typeof d.source !== "string" ? d.source.x ?? 0 : 0
          )
          .attr("y1", (d) =>
            typeof d.source !== "string" ? d.source.y ?? 0 : 0
          )
          .attr("x2", (d) =>
            typeof d.target !== "string" ? d.target.x ?? 0 : 0
          )
          .attr("y2", (d) =>
            typeof d.target !== "string" ? d.target.y ?? 0 : 0
          );

        nodeSel
          .attr("cx", (d) => d.x ?? 0)
          .attr("cy", (d) => d.y ?? 0);

        miniLinks
          .attr("x1", (d) =>
            typeof d.source !== "string"
              ? (d.source.x ?? 0) * scaleX
              : 0
          )
          .attr("y1", (d) =>
            typeof d.source !== "string"
              ? (d.source.y ?? 0) * scaleY
              : 0
          )
          .attr("x2", (d) =>
            typeof d.target !== "string"
              ? (d.target.x ?? 0) * scaleX
              : 0
          )
          .attr("y2", (d) =>
            typeof d.target !== "string"
              ? (d.target.y ?? 0) * scaleY
              : 0
          );

        miniNodes
          .attr("cx", (d) => (d.x ?? 0) * scaleX)
          .attr("cy", (d) => (d.y ?? 0) * scaleY);
      });

    /* ========== CLEAN UP (important for React) =============== */
    return () => {
      tooltip.remove();
      simulation.stop();
      svg.on(".zoom", null);
      minimapSvg.on(".click", null);
    };
  }, [nodes, links]);

  /* ------------------------------------------------------------
      GENRE LEGEND (simple HTML)
     ------------------------------------------------------------ */
  const legendGenres = Array.from(
    new Set(
      nodes.map((n) => (n.genre[0] ?? "unknown").toLowerCase())
    )
  );

  return (
    <div>
      <svg ref={svgRef} />
      <svg
        ref={minimapRef}
        style={{
          position: "fixed",
          left: 16,
          top: 16,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          padding: 12,
          background: "rgba(0,0,0,0.75)",
          borderRadius: 8,
          color: "#ffffff",
          fontFamily: "Afacad, sans-serif",
          fontSize: 12,
        }}
      >
        <strong>GENRES</strong>
        <div style={{ marginTop: 6 }}>
          {legendGenres.map((g) => (
            <div
              key={g}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background:
                    (g &&
                      (d3
                        .scaleOrdinal<string, string>(d3.schemeTableau10)(
                        g
                      ) as string)) || GENRE_FALLBACK_COLOR,
                }}
              />
              <span>{g.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
