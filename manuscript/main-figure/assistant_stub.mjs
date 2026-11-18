// A stand-in Ollama for the Graph Assistant panel: no model runs on the capture
// machine, so the page's fetch to the endpoint gets scripted replies. They go
// through the real client, streaming parser, sentinel/intent handling, query
// generator and renderer; only the model's words are fixed. Every number in a
// reply is read from the loaded graph, not typed in.

export async function stubOllama(page) {
  await page.evaluate(() => {
    const ENDPOINT = 'http://localhost:11434';
    const MODEL = 'qwen3.5:9b';
    const FRAME_MS = 120;
    const WNT = 'Node filters::Mechanisms::Wnt signaling';
    const TOLVAPTAN = 'Node filters::Drug interference::tolvaptan';
    const c = window.cache;
    const prop = (n, group, name) => n.D4Data?.['Node filters']?.[group]?.[name];

    // Visible nodes only: isolated members are hidden from the view.
    const tolvaptanWnt = c.graphData.filterNodes((_, a) => !a.hidden).map((id) => c.nodeRef.get(id))
      .filter((n) => prop(n, 'Drug interference', 'tolvaptan') === 1 && prop(n, 'Mechanisms', 'Wnt signaling'))
      .map((n) => n.label);

    const replies = {
      tolvaptan: () => ({
        thinking: 'The user wants Wnt signaling members that carry the tolvaptan interference flag. ' +
          'Both properties exist: a Wnt signaling category under Mechanisms and a tolvaptan flag under Drug interference.',
        content: `**${tolvaptanWnt.slice(0, -1).join('**, **')}** and **${tolvaptanWnt.at(-1)}**: ` +
          'the Wnt signaling members of the *Tolvaptan signature* group.\n\n' +
          '<<<QUERY_INTENT>>>{"summary":"Wnt signaling members with tolvaptan interference","scope":"node"}<<<END>>>',
      }),
      selected: () => {
        const rows = [...c.selectedNodes].map((id) => c.nodeRef.get(id)).map((n) =>
          `| ${n.label} | ${prop(n, 'Literature evidence', 'ADPKD literature evidence')} | ` +
          `${prop(n, 'Biomarker annotation', 'ADPKD biomarker score')} | ${prop(n, 'Mechanisms', 'Wnt signaling')} | ` +
          `${Number(prop(n, 'Genetic associations', 'ADPKD genetic association score')).toFixed(2)} |`);
        const labels = [...c.selectedNodes].map((id) => c.nodeRef.get(id).label);
        return {
          thinking: `Two nodes are selected: ${labels.join(' and ')}. Summarise their key properties.`,
          content: `**${labels.join('** and **')}**, the two polycystins:\n\n` +
            '| Node | Literature | Biomarker | Wnt | Genetic |\n' +
            '|---|---|---|---|---|\n' + rows.join('\n'),
        };
      },
    };

    const query = {
      queries: [{
        title: 'Wnt signaling members with tolvaptan interference',
        expr: {
          kind: 'binary', bop: 'AND',
          left: { kind: 'condition', field: WNT, op: 'IN', values: ['involved in', 'modulates positive', 'modulates negative', 'modulates'] },
          right: { kind: 'condition', field: TOLVAPTAN, op: 'IS_TRUE' },
        },
      }],
    };

    const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      const u = String(url);
      if (!u.startsWith(ENDPOINT)) return realFetch(url, init);
      if (u.endsWith('/api/tags')) return json({ models: [{ name: MODEL, model: MODEL }] });
      if (!u.endsWith('/api/chat')) return new Response('not found', { status: 404 });

      const body = JSON.parse(init.body);
      if (body.format) return json({ message: { role: 'assistant', content: JSON.stringify(query) } });
      const last = body.messages.at(-1).content;
      const question = last.match(/<user_question>\n([\s\S]*?)\n<\/user_question>/)?.[1] ?? '';
      const reply = (/tolvaptan/i.test(question) ? replies.tolvaptan : replies.selected)();
      // Word-sized frames at a local model's pace, so the "Thought for …" line
      // reports a plausible duration and token count.
      const words = (s) => s.split(/(?<=\s)/);
      const frames = [
        ...words(reply.thinking).map((w) => ({ message: { role: 'assistant', content: '', thinking: w } })),
        ...words(reply.content).map((w) => ({ message: { role: 'assistant', content: w } })),
        { message: { role: 'assistant', content: '' }, done: true },
      ];
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const f of frames) {
            controller.enqueue(encoder.encode(JSON.stringify(f) + '\n'));
            await new Promise((r) => setTimeout(r, FRAME_MS));
          }
          controller.close();
        },
      });
      return new Response(stream);
    };
  });
}
