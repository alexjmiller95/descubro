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
   CONSTANTS
   ============================================================ */

const NODE_RADIUS = 20; // 50% smaller
const LINE_WIDTH = 2;   // main + soft link thickness
const GENRE_FALLBACK_COLOR = "#888888";
const SOFT_LINK_COLOR = "#888888";

const ARTIST_API =
  "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=500";

/* For legend UI */
type LegendItem = { genre: string; color: string };

/* ============================================================
   COMPONENT
   ============================================================ */

export default function Page() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const minimapRef = useRef<SVGSVGElement | null>(null);

  // Search + legend state
  const [searchTerm, setSearchTerm] = useState("");
  const [activeGenre, setActiveGenre] = useState<string | null>(null);
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);

  // D3 selections for reactive filtering
  const nodeSelRef = useRef<
    d3.Selection<SVGCircleElement, ArtistRecord, SVGGElement, unknown> | null
  >(null);
  const linkSelRef = useRef<
    d3.Selection<SVGLineElement, Link, SVGGElement, unknown> | null
  >(null);
  const softLinkSelRef = useRef<
    d3.Selection<SVGLineElement, Link, SVGGElement, unknown> | null
  >(null);

  /* ------------------------------------------------------------
      EFFECT 1 — FETCH + BUILD GRAPH
     ------------------------------------------------------------ */
  useEffect(() => {
    async function run() {
      if (!svgRef.current || !minimapRef.current) return;

      // ---------- 1. Fetch artists from Bubble ----------
      let artistsRaw: any[] = [];
      try {
        const res = await fetch(ARTIST_API);
        if (!res.ok) {
          console.error("Artist API error:", res.status, res.statusText);
          return;
        }
        const json = await res.json();
        artistsRaw = json.response?.results ?? [];
      } catch (err) {
        console.error("Failed to fetch artists:", err);
        return;
      }

      if (!artistsRaw.length) {
        console.warn("No artists returned from Bubble.");
        return;
      }

      // Map Bubble fields → ArtistRecord
      const nodes: ArtistRecord[] = artistsRaw.map((a: any) => {
        const id =
          a.spotify_id_text ||
          a.spotify_id ||
          a.artist_id ||
          a._id ||
          String(Math.random());

        const name =
          a.name_text || a.name || a.artist_name || "Unknown";

        const genreList: string[] =
          Array.isArray(a.genre_list_text) && a.genre_list_text.length
            ? a.genre_list_text
            : Array.isArray(a.genre)
            ? a.genre
            : typeof a.genre === "string"
            ? [a.genre]
            : [];

        const image: string | null =
          a.image_url_text || a.image_url || null;

        const spotify: string | null =
          a.spotify_id_text || a.spotify_id || null;

        return {
          id,
          name,
          genre: genreList,
          image,
          spotify,
        };
      });

      // ---------- 2. Build STRONG links by shared primary genre ----------
      const primaryGenres = nodes.map((n) =>
        (n.genre[0] ?? "unknown").toLowerCase()
      );
      const uniqueGenres = Array.from(new Set(primaryGenres));

      const colorScale = d3
        .scaleOrdinal<string, string>(d3.schemeTableau10)
        .domain(uniqueGenres);

      const genreColor: Record<string, string> = {};
      uniqueGenres.forEach((g) => (genreColor[g] = colorScale(g)));

      // Save for legend UI
      setLegendItems(
        uniqueGenres.map((g) => ({
          genre: g,
          color: genreColor[g] ?? GENRE_FALLBACK_COLOR,
        }))
      );

      const width =
        typeof window !== "undefined" ? window.innerWidth : 1400;
      const height =
        typeof window !== "undefined" ? window.innerHeight : 900;

      const bandStep = width / (uniqueGenres.length + 1);
      const genreCenterX: Record<string, number> = {};
      uniqueGenres.forEach((g, i) => {
        genreCenterX[g] = bandStep * (i + 1);
      });

      const links: Link[] = [];
      const groups: Record<string, ArtistRecord[]> = {};
      nodes.forEach((n) => {
        const g = (n.genre[0] ?? "unknown").toLowerCase();
        if (!groups[g]) groups[g] = [];
        groups[g].push(n);
      });

      Object.entries(groups).forEach(([g, groupNodes]) => {
        if (groupNodes.length < 2) return;
        const sorted = [...groupNodes].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        for (let i = 0; i < sorted.length - 1; i++) {
          const s = sorted[i];
          const t = sorted[i + 1];
          links.push({
            source: s.id,
            target: t.id,
            sourceId: s.id,
            targetId: t.id,
            genre: g,
          });
        }
      });

      // ---------- 3. Build SOFT links (keyword-based genre similarity) ----------
      const softLinks: Link[] = [];

      const linkKey = (a: string, b: string) =>
        a < b ? `${a}__${b}` : `${b}__${a}`;

      const existingStrongKeys = new Set<string>(
        links.map((l) => linkKey(l.sourceId, l.targetId))
      );

      function hasKeywordOverlap(g1: string, g2: string) {
        const a = g1.toLowerCase().split(/\s+/).filter(Boolean);
        const b = g2.toLowerCase().split(/\s+/).filter(Boolean);
        return a.some((word) => b.includes(word));
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const g1 = (nodes[i].genre[0] ?? "").toLowerCase();
          const g2 = (nodes[j].genre[0] ?? "").toLowerCase();
          if (!g1 || !g2) continue;
          // Only consider if primary genres differ but share keyword
          if (g1 === g2) continue;
          if (!hasKeywordOverlap(g1, g2)) continue;

          const key = linkKey(nodes[i].id, nodes[j].id);
          if (existingStrongKeys.has(key)) continue; // skip if already strong

          softLinks.push({
            source: nodes[i].id,
            target: nodes[j].id,
            sourceId: nodes[i].id,
            targetId: nodes[j].id,
            genre: "soft-related",
          });
        }
      }

      // ---------- 4. Setup SVGs ----------
      const svg = d3.select(svgRef.current);
      const minimapSvg = d3.select(minimapRef.current);
      svg.selectAll("*").remove();
      minimapSvg.selectAll("*").remove();

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

      const mainG = svg.append("g");
      const minimapG = minimapSvg.append("g");

      // ---------- 5. Tooltip ----------
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

      // ---------- 6. Image patterns ----------
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

      // ---------- 7. Strong Links ----------
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

      // ---------- 8. Soft Links (dotted, grey) ----------
      const softLinkSel = mainG
        .append("g")
        .attr("stroke-linecap", "round")
        .selectAll("line")
        .data(softLinks)
        .enter()
        .append("line")
        .attr("stroke-width", LINE_WIDTH)
        .attr("stroke", SOFT_LINK_COLOR)
        .attr("stroke-dasharray", "4 4")
        .attr("stroke-opacity", 0.5);

      // ---------- 9. Minimap links ----------
      const miniLinks = minimapG
        .append("g")
        .selectAll("line")
        .data(links)
        .enter()
        .append("line")
        .attr("stroke-width", 1)
        .attr("stroke", (d) => genreColor[d.genre] ?? "#555")
        .attr("stroke-opacity", 0.7);

      const miniSoftLinks = minimapG
        .append("g")
        .selectAll("line")
        .data(softLinks)
        .enter()
        .append("line")
        .attr("stroke-width", 0.8)
        .attr("stroke", SOFT_LINK_COLOR)
        .attr("stroke-dasharray", "3 3")
        .attr("stroke-opacity", 0.4);

      // ---------- 10. Nodes ----------
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

      const miniNodes = minimapG
        .append("g")
        .selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("r", NODE_RADIUS * scaleX * 0.9)
        .attr("fill", "#777")
        .attr("stroke", "#111")
        .attr("stroke-width", 1);

      // Save refs for filtering
      nodeSelRef.current = nodeSel;
      linkSelRef.current = linkSel;
      softLinkSelRef.current = softLinkSel;

      // ---------- 11. Hover behaviour ----------
      nodeSel
        .on("mouseover", function (event, d) {
          d3.select(this)
            .transition()
            .duration(150)
            .attr("r", NODE_RADIUS * 1.3);

          tooltip
            .style("opacity", 1)
            .html(
              `<strong>${d.name.toUpperCase()}</strong><br/>
               GENRES: ${d.genre.join(", ").toUpperCase()}`
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
          d3.select(this)
            .transition()
            .duration(150)
            .attr("r", NODE_RADIUS);
          tooltip.style("opacity", 0);
        });

      // ---------- 12. Minimap viewport ----------
      const viewportRect = minimapSvg
        .append("rect")
        .attr("fill", "none")
        .attr("stroke", "white")
        .attr("stroke-width", 1)
        .attr("pointer-events", "none");

      let currentTransform = d3.zoomIdentity;

      const updateMinimapViewport = () => {
        const k = currentTransform.k;
        const tx = currentTransform.x;
        const ty = currentTransform.y;

        const x0 = -tx / k;
        const x1 = (width - tx) / k;
        const y0 = -ty / k;
        const y1 = (height - ty) / k;

        viewportRect
          .attr("x", x0 * scaleX)
          .attr("y", y0 * scaleY)
          .attr("width", (x1 - x0) * scaleX)
          .attr("height", (y1 - y0) * scaleY);
      };

      // click minimap to centre
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

      // ---------- 13. Zoom + pan ----------
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

      // ---------- 14. Force simulation with genre clustering ----------
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
              typeof d.source !== "string"
                ? d.source.x ?? 0
                : 0
            )
            .attr("y1", (d) =>
              typeof d.source !== "string"
                ? d.source.y ?? 0
                : 0
            )
            .attr("x2", (d) =>
              typeof d.target !== "string"
                ? d.target.x ?? 0
                : 0
            )
            .attr("y2", (d) =>
              typeof d.target !== "string"
                ? d.target.y ?? 0
                : 0
            );

          softLinkSel
            .attr("x1", (d) =>
              typeof d.source !== "string"
                ? d.source.x ?? 0
                : 0
            )
            .attr("y1", (d) =>
              typeof d.source !== "string"
                ? d.source.y ?? 0
                : 0
            )
            .attr("x2", (d) =>
              typeof d.target !== "string"
                ? d.target.x ?? 0
                : 0
            )
            .attr("y2", (d) =>
              typeof d.target !== "string"
                ? d.target.y ?? 0
                : 0
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

          miniSoftLinks
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

      // ---------- 15. Cleanup ----------
      return () => {
        tooltip.remove();
        simulation.stop();
        svg.on(".zoom", null);
        minimapSvg.on("click", null);
        nodeSelRef.current = null;
        linkSelRef.current = null;
        softLinkSelRef.current = null;
      };
    }

    run();
  }, []);

  /* ------------------------------------------------------------
      EFFECT 2 — SEARCH & GENRE FILTER (applies to nodes + links)
     ------------------------------------------------------------ */
  useEffect(() => {
    const nodeSel = nodeSelRef.current;
    const linkSel = linkSelRef.current;
    const softLinkSel = softLinkSelRef.current;
    if (!nodeSel || !linkSel || !softLinkSel) return;

    const term = searchTerm.trim().toLowerCase();
    const genreFilter = activeGenre ? activeGenre.toLowerCase() : null;

    const visibleIds = new Set<string>();

    nodeSel
      .transition()
      .duration(200)
      .attr("opacity", (d) => {
        const matchesName = d.name.toLowerCase().includes(term);
        const matchesGenreText = d.genre.some((g) =>
          g.toLowerCase().includes(term)
        );
        const matchesSearch =
          term === "" || matchesName || matchesGenreText;

        const primary = (d.genre[0] ?? "unknown").toLowerCase();
        const matchesLegend =
          !genreFilter || primary === genreFilter;

        const visible = matchesSearch && matchesLegend;
        if (visible) visibleIds.add(d.id);
        return visible ? 1 : 0.15;
      });

    linkSel
      .transition()
      .duration(200)
      .attr("stroke-opacity", (l) => {
        const sId =
          typeof l.source === "string"
            ? l.source
            : (l.source as ArtistRecord).id;
        const tId =
          typeof l.target === "string"
            ? l.target
            : (l.target as ArtistRecord).id;
        return visibleIds.has(sId) && visibleIds.has(tId) ? 0.9 : 0.05;
      });

    // Soft links respect the same filtering rules (Option A)
    softLinkSel
      .transition()
      .duration(200)
      .attr("stroke-opacity", (l) => {
        const sId =
          typeof l.source === "string"
            ? l.source
            : (l.source as ArtistRecord).id;
        const tId =
          typeof l.target === "string"
            ? l.target
            : (l.target as ArtistRecord).id;
        return visibleIds.has(sId) && visibleIds.has(tId) ? 0.5 : 0.05;
      });
  }, [searchTerm, activeGenre]);

  /* ============================================================
      JSX UI: Search bar + legend + SVGs
     ============================================================ */

  return (
    <div>
      {/* SEARCH BAR */}
      <div
        style={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          background: "rgba(0,0,0,0.7)",
          padding: "10px 14px",
          borderRadius: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
          color: "white",
          fontFamily: "Afacad, sans-serif",
        }}
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search artist or genre…"
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border: "none",
            width: 260,
            outline: "none",
            background: "#222",
            color: "white",
            fontFamily: "Afacad, sans-serif",
          }}
        />

        <button
          onClick={() => {
            setSearchTerm("");
            setActiveGenre(null);
          }}
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: "#444",
            color: "white",
            border: "none",
            cursor: "pointer",
            fontFamily: "Afacad, sans-serif",
          }}
        >
          Reset
        </button>
      </div>

      {/* LEGEND */}
      <div
        style={{
          position: "fixed",
          top: 70,
          right: 16,
          zIndex: 10,
          padding: 12,
          background: "rgba(0,0,0,0.75)",
          borderRadius: 8,
          color: "#ffffff",
          fontFamily: "Afacad, sans-serif",
          fontSize: 12,
          width: 190,
          maxHeight: "60vh",
          overflowY: "auto",
        }}
      >
        <strong>GENRES</strong>

        <div style={{ marginTop: 10 }}>
          {legendItems.map((item) => {
            const g = item.genre;
            const lower = g.toLowerCase();
            const active = activeGenre === lower;
            return (
              <div
                key={g}
                onClick={() =>
                  setActiveGenre((prev) =>
                    prev === lower ? null : lower
                  )
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                  cursor: "pointer",
                  opacity:
                    activeGenre && !active
                      ? 0.4
                      : 1,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: item.color,
                  }}
                />
                <span>{g.toUpperCase()}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* MAIN SVG + MINIMAP */}
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
    </div>
  );
}
