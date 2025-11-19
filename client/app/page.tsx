"use client";

import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { SimulationNodeDatum } from "d3";

/* ============================================================
   TYPES
   ============================================================ */

export interface ArtistRecord extends SimulationNodeDatum {
  id: string; // this will be Artist.artist_id (Spotify ID)
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
  strength?: number;
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const NODE_RADIUS = 20; // 50% smaller
const LINE_WIDTH = 2; // thicker lines than before
const GENRE_FALLBACK_COLOR = "#888888";
const SOFT_LINK_COLOR = "#888888";

const ARTIST_API =
  "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=2000";

const ARTIST_CONNECTION_API =
  "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=2000";

type LegendItem = { genre: string; color: string };

/* ============================================================
   COMPONENT
   ============================================================ */

export default function Page() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const minimapRef = useRef<SVGSVGElement | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeGenre, setActiveGenre] = useState<string | null>(null);
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);

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
    let destroy: (() => void) | undefined;

    (async () => {
      if (!svgRef.current || !minimapRef.current) return;

      // ---------- 1. Fetch Artists + ArtistConnections ----------
      let artistsRaw: any[] = [];
      let connectionsRaw: any[] = [];

      try {
        const [resArtists, resConnections] = await Promise.all([
          fetch(ARTIST_API),
          fetch(ARTIST_CONNECTION_API),
        ]);

        if (!resArtists.ok) {
          console.error(
            "Artist API error:",
            resArtists.status,
            resArtists.statusText
          );
          return;
        }
        if (!resConnections.ok) {
          console.error(
            "ArtistConnection API error:",
            resConnections.status,
            resConnections.statusText
          );
          return;
        }

        const jsonArtists = await resArtists.json();
        const jsonConnections = await resConnections.json();

        artistsRaw = jsonArtists.response?.results ?? [];
        connectionsRaw = jsonConnections.response?.results ?? [];

        console.log("Received Artists:", artistsRaw.length);
        console.log(
          "Received ArtistConnections:",
          connectionsRaw.length
        );
      } catch (err) {
        console.error("Failed to fetch data from Bubble:", err);
        return;
      }

      if (!artistsRaw.length) {
        console.warn("No artists returned from Bubble.");
        return;
      }

      // ---------- 2. Map Bubble Artist objects → nodes ----------
      const nodes: ArtistRecord[] = artistsRaw.map((a: any) => {
        // use artist_id (Spotify) as our graph id
        const id: string =
          a.artist_id_text ||
          a.artist_id ||
          a.spotify_id_text ||
          a.spotify_id ||
          a._id ||
          String(Math.random());

        const name: string =
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

      const nodeById: Record<string, ArtistRecord> = {};
      nodes.forEach((n) => {
        nodeById[n.id] = n;
      });

      // ---------- 3. Genre palette + positioning ----------
      const primaryGenres = nodes.map((n) =>
        (n.genre[0] ?? "unknown").toLowerCase()
      );
      const uniqueGenres = Array.from(new Set(primaryGenres));

      const colorScale = d3
        .scaleOrdinal<string, string>(d3.schemeTableau10)
        .domain(uniqueGenres);

      const genreColor: Record<string, string> = {};
      uniqueGenres.forEach((g) => (genreColor[g] = colorScale(g)));

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

      // ---------- 4. STRONG links from ArtistConnection ----------
      const links: Link[] = [];
      const strongKey = (a: string, b: string) =>
        a < b ? `${a}__${b}` : `${b}__${a}`;
      const existingStrongKeys = new Set<string>();

      connectionsRaw.forEach((c: any) => {
        // your new workflow saves these as text fields => *_text
        const sourceId: string | undefined =
          c.artist_1_id_text || c.artist_1_id;
        const targetId: string | undefined =
          c.artist_2_id_text || c.artist_2_id;

        if (!sourceId || !targetId) return;
        if (!nodeById[sourceId] || !nodeById[targetId]) return;

        const key = strongKey(sourceId, targetId);
        if (existingStrongKeys.has(key)) return;
        existingStrongKeys.add(key);

        const genreValue: string =
          (Array.isArray(c.genre_list_text) &&
            c.genre_list_text[0]) ||
          c.genre_text ||
          "unknown";

        const strength: number =
          c.connection_strength_number ?? 1;

        links.push({
          source: sourceId,
          target: targetId,
          sourceId,
          targetId,
          genre: String(genreValue).toLowerCase(),
          strength,
        });
      });

      console.log(
        "Built strong links from ArtistConnection:",
        links.length
      );

      // ---------- 5. SOFT links (keyword-based genre similarity) ----------
      const softLinks: Link[] = [];

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
          if (g1 === g2) continue;
          if (!hasKeywordOverlap(g1, g2)) continue;

          const key = strongKey(nodes[i].id, nodes[j].id);
          if (existingStrongKeys.has(key)) continue;

          softLinks.push({
            source: nodes[i].id,
            target: nodes[j].id,
            sourceId: nodes[i].id,
            targetId: nodes[j].id,
            genre: "soft-related",
          });
        }
      }

      console.log("Built soft genre links:", softLinks.length);

      // ---------- 6. Setup SVGs ----------
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

      // ---------- 7. Tooltip ----------
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

      // ---------- 8. Image patterns ----------
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

      // ---------- 9. Strong Links ----------
      const linkSel = mainG
        .append("g")
        .attr("stroke-linecap", "round")
        .selectAll("line")
        .data(links)
        .enter()
        .append("line")
        .attr("stroke-width", (d) =>
          Math.max(LINE_WIDTH, (d.strength ?? 1) * (LINE_WIDTH / 1.5))
        )
        .attr("stroke", (d) => genreColor[d.genre] ?? GENRE_FALLBACK_COLOR)
        .attr("stroke-opacity", 0.8);

      // ---------- 10. Soft Links (dotted, grey) ----------
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

      // ---------- 11. Minimap links ----------
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

      // ---------- 12. Nodes ----------
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

      nodeSelRef.current = nodeSel;
      linkSelRef.current = linkSel;
      softLinkSelRef.current = softLinkSel;

      // ---------- 13. Hover behaviour ----------
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

      // ---------- 14. Minimap viewport ----------
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

      let zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 5])
        .on("zoom", (event) => {
          currentTransform = event.transform;
          mainG.attr("transform", currentTransform.toString());
          updateMinimapViewport();
        });

      svg.call(zoomBehavior as any);
      updateMinimapViewport();

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

      // ---------- 15. Force simulation ----------
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

      // ---------- 16. Cleanup ----------
      destroy = () => {
        tooltip.remove();
        simulation.stop();
        svg.on(".zoom", null);
        minimapSvg.on("click", null);
        nodeSelRef.current = null;
        linkSelRef.current = null;
        softLinkSelRef.current = null;
      };
    })();

    return () => {
      if (destroy) destroy();
    };
  }, []);

  /* ------------------------------------------------------------
      EFFECT 2 — SEARCH & GENRE FILTER
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
      JSX UI
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
                    activeGenre && !active ? 0.4 : 1,
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
