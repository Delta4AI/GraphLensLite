import {StaticUtilities} from './static.js';

class StringDemoDataLoader {
  constructor(cache, genes, species = 9606, amountOfNodes = 50, requiredScore = 400) {
    this.cache = cache;
    this.baseUrl = 'https://string-db.org/api/json';
    this.genes = genes;
    this.species = species;
    this.amountOfNodes = amountOfNodes;
    this.requiredScore = requiredScore;
  }

async loadNetwork() {
  if (this.genes.length === 1 && this.amountOfNodes === 0) {
    return await this._loadSingleProtein();
  }

  const params = new URLSearchParams({
    identifiers: this.genes.join('%0d'),
    species: this.species,
    add_nodes: this.amountOfNodes,
    required_score: this.requiredScore
  });

  const url = `${this.baseUrl}/network?${params}`;

  await this.cache.ui.showLoading("Demo Data", `Loading STRING network with ${this.genes.length} genes: ${this.genes.join(',')}, ${this.amountOfNodes} additional nodes, species ${this.species}, minimum confidence: ${this.requiredScore}. URL: ${url}`);
  try {
    const stringData = await this._fetchFromString(url);

    if (!stringData || stringData.length === 0) {
      this.cache.ui.warning('No interaction data returned from STRING');
      return null;
    }

    const allProteins = new Set();
    stringData.forEach(interaction => {
      allProteins.add(interaction.preferredName_A);
      allProteins.add(interaction.preferredName_B);
    });

    const annotations = await this._fetchFunctionalAnnotations(Array.from(allProteins));
    return this._convertToAppFormat(stringData, annotations);
  } catch (err) {
    this.cache.ui.error(`Failed to load STRING network. Make sure gene symbols and species ID exist. ${url}`);
    return null;
  }
}

async _loadSingleProtein() {
  const params = new URLSearchParams({
    identifiers: this.genes[0],
    species: this.species
  });

  const url = `${this.baseUrl}/get_string_ids?${params}`;

  await this.cache.ui.showLoading("Demo Data", `Loading protein info for ${this.genes[0]}, species ${this.species}. URL: ${url}`);

  try {
    const stringData = await this._fetchFromString(url);

    if (!stringData || stringData.length === 0) {
      this.cache.ui.warning('No protein data returned from STRING');
      return null;
    }

    const proteinInfo = stringData[0];
    const annotationData = await this._fetchFunctionalAnnotations([proteinInfo.preferredName]);

    // Convert single protein to app format (no edges, just one node)
    return this._convertSingleProteinToAppFormat(proteinInfo, annotationData);
  } catch (err) {
    this.cache.ui.error(`Failed to load protein info from STRING. Make sure gene symbol and species ID exist. ${url}`);
    return null;
  }
}

_convertSingleProteinToAppFormat(proteinInfo, annotationData) {
  // Process annotations the same way as in _convertToAppFormat
  const annotationsBySourceAndSubcategory = new Map();
  const proteinToAnnotations = new Map();

  annotationData.forEach(ann => {
    const category = ann.category;
    const description = this._sanitizeForAST(ann.description);
    const proteins = ann.preferredNames || [];

    const { source, subcategory } = this._getSourceAndSubcategory(category);

    if (!annotationsBySourceAndSubcategory.has(source)) {
      annotationsBySourceAndSubcategory.set(source, new Map());
    }
    if (!annotationsBySourceAndSubcategory.get(source).has(subcategory)) {
      annotationsBySourceAndSubcategory.get(source).set(subcategory, new Set());
    }
    annotationsBySourceAndSubcategory.get(source).get(subcategory).add(description);

    proteins.forEach(protein => {
      if (!proteinToAnnotations.has(protein)) {
        proteinToAnnotations.set(protein, new Map());
      }
      if (!proteinToAnnotations.get(protein).has(source)) {
        proteinToAnnotations.get(protein).set(source, new Map());
      }
      if (!proteinToAnnotations.get(protein).get(source).has(subcategory)) {
        proteinToAnnotations.get(protein).get(source).set(subcategory, []);
      }
      proteinToAnnotations.get(protein).get(source).get(subcategory).push(description);
    });
  });

  // Filter out categories with only 1 unique value
  const filteredAnnotations = new Map();
  annotationsBySourceAndSubcategory.forEach((subcategories, source) => {
    const filteredSubcategories = new Map();
    subcategories.forEach((annotations, subcategory) => {
      if (annotations.size > 1) {
        filteredSubcategories.set(subcategory, annotations);
      }
    });
    if (filteredSubcategories.size > 0) {
      filteredAnnotations.set(source, filteredSubcategories);
    }
  });

  // Build headers
  const nodeDataHeaders = [];
  filteredAnnotations.forEach((subcategories, source) => {
    subcategories.forEach((annotations, subcategory) => {
      nodeDataHeaders.push({subGroup: source, key: subcategory});
    });
  });

  // Build node with filters
  const proteinAnnotations = proteinToAnnotations.get(proteinInfo.preferredName) || new Map();
  const nodeFilters = {};

  filteredAnnotations.forEach((subcategories, source) => {
    if (!nodeFilters[source]) {
      nodeFilters[source] = {};
    }

    subcategories.forEach((annotations, subcategory) => {
      const proteinSourceAnnotations = proteinAnnotations.get(source) || new Map();
      const proteinSubcategoryAnnotations = proteinSourceAnnotations.get(subcategory) || [];
      nodeFilters[source][subcategory] = proteinSubcategoryAnnotations.length > 0 ?
        proteinSubcategoryAnnotations[0] : `No ${subcategory}`;
    });
  });

  return {
    nodes: [{
      id: proteinInfo.stringId,
      label: proteinInfo.preferredName,
      style: {
        labelText: proteinInfo.preferredName,
      },
      D4Data: {
        'Node filters': nodeFilters
      }
    }],
    edges: [],
    nodeDataHeaders,
    edgeDataHeaders: []
  };
}

_getEdgeColor(score, minScore, maxScore) {
  const normalizedScore = maxScore === minScore ? 0 : (score - minScore) / (maxScore - minScore);

  const greyColor = {r: 135, g: 137, b: 150};    // Low confidence - neutral
  const blueColor = {r: 140, g: 166, b: 217};    // Medium confidence - cool
  const purpleColor = {r: 153, g: 170, b: 187};  // Medium confidence - transitional
  const pinkColor = {r: 239, g: 176, b: 170};    // High confidence - warm

  let r, g, b;

  if (normalizedScore <= 0.33) {
    // Grey to Blue (0-33%)
    const t = normalizedScore / 0.33;
    r = Math.round(greyColor.r + (blueColor.r - greyColor.r) * t);
    g = Math.round(greyColor.g + (blueColor.g - greyColor.g) * t);
    b = Math.round(greyColor.b + (blueColor.b - greyColor.b) * t);
  } else if (normalizedScore <= 0.66) {
    // Blue to Purple (33-66%)
    const t = (normalizedScore - 0.33) / 0.33;
    r = Math.round(blueColor.r + (purpleColor.r - blueColor.r) * t);
    g = Math.round(blueColor.g + (purpleColor.g - blueColor.g) * t);
    b = Math.round(blueColor.b + (purpleColor.b - blueColor.b) * t);
  } else {
    // Purple to Pink (66-100%)
    const t = (normalizedScore - 0.66) / 0.34;
    r = Math.round(purpleColor.r + (pinkColor.r - purpleColor.r) * t);
    g = Math.round(purpleColor.g + (pinkColor.g - purpleColor.g) * t);
    b = Math.round(purpleColor.b + (pinkColor.b - purpleColor.b) * t);
  }

  return `rgb(${r}, ${g}, ${b})`;
}

  async _fetchFromString(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`STRING API request failed: ${response.status}`);
    }
    return await response.json();
  }

  async _fetchFunctionalAnnotations(proteins) {
    const url = `${this.baseUrl}/functional_annotation?identifiers=${proteins.join('%0d')}&species=${this.species}`;
    const response = await fetch(url);
    if (!response.ok) return [];
    return await response.json();
  }

  _getSourceAndSubcategory(category) {
    const mapping = {
      'Process': {source: 'Gene Ontology', subcategory: 'Biological Process'},
      'Function': {source: 'Gene Ontology', subcategory: 'Molecular Function'},
      'Component': {source: 'Gene Ontology', subcategory: 'Cellular Component'},
      'Keyword': {source: 'UniProt', subcategory: 'Annotated Keywords'},
      'KEGG': {source: 'KEGG', subcategory: 'Pathways'},
      'RCTM': {source: 'Reactome', subcategory: 'Pathways'},
      'HPO': {source: 'Monarch', subcategory: 'Human Phenotype'},
      'MPO': {source: 'Monarch', subcategory: 'Mammalian Phenotype'},
      'DPO': {source: 'Monarch', subcategory: 'Drosophila Phenotype'},
      'WPO': {source: 'Monarch', subcategory: 'C. elegans Phenotype'},
      'ZPO': {source: 'Monarch', subcategory: 'Zebrafish Phenotype'},
      'FYPO': {source: 'Monarch', subcategory: 'Fission Yeast Phenotype'},
      'Pfam': {source: 'Pfam', subcategory: 'Protein Domains'},
      'SMART': {source: 'SMART', subcategory: 'Protein Domains'},
      'InterPro': {source: 'InterPro', subcategory: 'Protein Domains and Features'},
      'PMID': {source: 'PubMed', subcategory: 'Reference Publications'},
      'NetworkNeighborAL': {source: 'STRING', subcategory: 'Local Network Cluster'},
      'COMPARTMENTS': {source: 'Compartments', subcategory: 'Subcellular Localization'},
      'TISSUES': {source: 'Tissues', subcategory: 'Tissue Expression'},
      'DISEASES': {source: 'Diseases', subcategory: 'Disease-gene Associations'},
      'WikiPathways': {source: 'WikiPathways', subcategory: 'WikiPathways'}
    };

    return mapping[category] || {source: this._sanitizeForAST(category), subcategory: this._sanitizeForAST(category)};
  }

  _sanitizeForAST(str) {
    return StaticUtilities.sanitizeForAST(str);
  }

  _convertToAppFormat(stringData, annotationData) {
    const nodeMap = new Map();
    const edges = [];

    // Group annotations by source and subcategory
    const annotationsBySourceAndSubcategory = new Map();
    const proteinToAnnotations = new Map();

    annotationData.forEach(ann => {
      const category = ann.category;
      const description = this._sanitizeForAST(ann.description);
      const proteins = ann.preferredNames || [];

      const { source, subcategory } = this._getSourceAndSubcategory(category);

      // Track all annotations per source/subcategory
      if (!annotationsBySourceAndSubcategory.has(source)) {
        annotationsBySourceAndSubcategory.set(source, new Map());
      }
      if (!annotationsBySourceAndSubcategory.get(source).has(subcategory)) {
        annotationsBySourceAndSubcategory.get(source).set(subcategory, new Set());
      }
      annotationsBySourceAndSubcategory.get(source).get(subcategory).add(description);

      // Map proteins to their annotations per source/subcategory
      proteins.forEach(protein => {
        if (!proteinToAnnotations.has(protein)) {
          proteinToAnnotations.set(protein, new Map());
        }
        if (!proteinToAnnotations.get(protein).has(source)) {
          proteinToAnnotations.get(protein).set(source, new Map());
        }
        if (!proteinToAnnotations.get(protein).get(source).has(subcategory)) {
          proteinToAnnotations.get(protein).get(source).set(subcategory, []);
        }
        proteinToAnnotations.get(protein).get(source).get(subcategory).push(description);
      });
    });

    // Filter out categories with only 1 unique value
    const filteredAnnotations = new Map();
    annotationsBySourceAndSubcategory.forEach((subcategories, source) => {
      const filteredSubcategories = new Map();
      subcategories.forEach((annotations, subcategory) => {
        if (annotations.size > 1) {
          filteredSubcategories.set(subcategory, annotations);
        }
      });
      if (filteredSubcategories.size > 0) {
        filteredAnnotations.set(source, filteredSubcategories);
      }
    });

    // Build headers for filtered categories
    const nodeDataHeaders = [];

    // Add header for each source/subcategory combination
    filteredAnnotations.forEach((subcategories, source) => {
      subcategories.forEach((annotations, subcategory) => {
        nodeDataHeaders.push({subGroup: source, key: subcategory});
      });
    });

    const edgeDataHeaders = [
      {subGroup: 'Scores', key: 'Combined Score'},
      {subGroup: 'Evidence Scores', key: 'Neighborhood Score'},
      {subGroup: 'Evidence Scores', key: 'Fusion Score'},
      {subGroup: 'Evidence Scores', key: 'Cooccurrence Score'},
      {subGroup: 'Evidence Scores', key: 'Coexpression Score'},
      {subGroup: 'Evidence Scores', key: 'Experimental Score'},
      {subGroup: 'Evidence Scores', key: 'Database Score'},
      {subGroup: 'Evidence Scores', key: 'Textmining Score'}
    ];

    stringData.forEach((interaction, index) => {
      const {
        stringId_A, stringId_B, preferredName_A, preferredName_B,
        score, nscore, fscore, pscore, ascore, escore, dscore, tscore
      } = interaction;

      const createNode = (stringId, preferredName) => {
        const proteinAnnotations = proteinToAnnotations.get(preferredName) || new Map();

        const nodeFilters = {};

        // Add filter for each source/subcategory combination
        filteredAnnotations.forEach((subcategories, source) => {
          if (!nodeFilters[source]) {
            nodeFilters[source] = {};
          }

          subcategories.forEach((annotations, subcategory) => {
            const proteinSourceAnnotations = proteinAnnotations.get(source) || new Map();
            const proteinSubcategoryAnnotations = proteinSourceAnnotations.get(subcategory) || [];
            nodeFilters[source][subcategory] = proteinSubcategoryAnnotations.length > 0 ?
              proteinSubcategoryAnnotations[0] : `No ${subcategory}`;
          });
        });

        return {
          id: stringId,
          label: preferredName,
          style: {
            labelText: preferredName,
          },
          D4Data: {
            'Node filters': nodeFilters
          }
        };
      };

      if (!nodeMap.has(preferredName_A)) {
        nodeMap.set(preferredName_A, createNode(stringId_A, preferredName_A));
      }

      if (!nodeMap.has(preferredName_B)) {
        nodeMap.set(preferredName_B, createNode(stringId_B, preferredName_B));
      }

      const scores = stringData.map(interaction => interaction.score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);

      edges.push({
        id: `${stringId_A}::${stringId_B}`,
        source: stringId_A,
        target: stringId_B,
        style: {
          stroke: this._getEdgeColor(score, minScore, maxScore),
          lineWidth: Math.max(0.1, score * 3),
        },
        D4Data: {
          'Edge filters': {
            'Scores': {
              'Combined Score': score
            },
            'Evidence Scores': {
              'Neighborhood Score': nscore,
              'Fusion Score': fscore,
              'Cooccurrence Score': pscore,
              'Coexpression Score': ascore,
              'Experimental Score': escore,
              'Database Score': dscore,
              'Textmining Score': tscore
            }
          }
        }
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      edges,
      nodeDataHeaders,
      edgeDataHeaders
    };
  }
}

export {StringDemoDataLoader};