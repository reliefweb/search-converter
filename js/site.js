(function () {
  'use strict';

  // Base API url.
  const apiUrl = 'https://api.reliefweb.int/v1/';

  // ReliefWeb rivers with pre-filter.
  const paths = {
    'headlines': {
      resource: 'reports',
      filter: {
        field: 'headline'
      }
    },
    'headlines/thumb': {
      resource: 'reports',
      filter: {
        field: 'headline.image'
      }
    },
    'updates': {
      resource: 'reports'
    },
    'updates/no-thumb': {
      resource: 'reports',
      filter: {
        field: 'format.id',
        value: [12, 12570, 38974],
        operator: 'OR',
        negate: true
      }
    },
    'maps': {
      resource: 'reports',
      filter: {
        field: 'format.id',
        value: [12, 12570, 38974],
        operator: 'OR'
      }
    },
    'countries': {
      resource: 'countries'
    },
    'disasters': {
      resource: 'disasters'
    },
    'organizations': {
      resource: 'sources'
    },
    'jobs': {
      resource: 'jobs'
    },
    'training': {
      resource: 'training'
    },
    'training/free': {
      resource: 'training',
      filter: {
        field: 'cost',
        value: 'free'
      }
    },
    'training/online': {
      resource: 'training',
      filter: {
        field: 'format.id',
        value: 4607
      }
    },
    'training/workshop': {
      resource: 'training',
      filter: {
        field: 'type.id',
        value: 4609
      }
    },
    'training/academic': {
      resource: 'training',
      filter: {
        field: 'type.id',
        value: 4610
      }
    }
  };

  // API resources.
  //
  // The format is [shortcut, operator, API field, fixed values (optional)].
  const resources = {
    reports: {
      primary_country: ['PC', 'AND', 'primary_country.id'],
      country: ['C', 'AND', 'country.id'],
      source: ['S', 'AND', 'source.id'],
      source_type: ['ST', 'OR', 'source.type.id'],
      theme: ['T', 'AND', 'theme.id'],
      format: ['F', 'OR', 'format.id'],
      disaster: ['D', 'OR', 'disaster.id'],
      disaster_type: ['DT', 'AND', 'disaster_type.id'],
      vulnerable_groups: ['VG', 'OR', 'vulnerable_groups.id'],
      language: ['L', 'OR', 'language.id'],
      date: ['DO', 'AND', 'date.original'],
      created: ['DA', 'AND', 'date.created'],
      feature: ['FE', 'OR', 'feature.id']
    },
    countries: {
      status: ['SS', 'OR', 'status', ['current', 'normal']]
    },
    disasters: {
      country: ['C', 'AND', 'country.id'],
      type: ['DT', 'OR', 'type.id'],
      status: ['SS', 'OR', 'status', ['current', 'past']],
      date: ['DA', 'AND', 'date.created']
    },
    organizations: {
      country: ['C', 'OR', 'country.id'],
      source_type: ['T', 'OR', 'type.id']
    },
    jobs: {
      type: ['TY', 'OR', 'type.id'],
      career_categories: ['CC', 'OR', 'career_categories.id'],
      experience: ['E', 'OR', 'experience.id'],
      theme: ['T', 'OR', 'theme.id'],
      country: ['C', 'OR', 'country.id'],
      source: ['S', 'OR', 'source.id'],
      source_type: ['ST', 'OR', 'source.type.id'],
      closing: ['DC', 'AND', 'date.closing'],
      created: ['DA', 'AND', 'date.created']
    },
    training: {
      type: ['TY', 'OR', 'type.id'],
      career_categories: ['CC', 'OR', 'career_categories.id'],
      format: ['F', 'AND', 'format.id'],
      cost: ['CO', 'OR', 'cost', ['fee-based', 'free']],
      theme: ['T', 'OR', 'theme.id'],
      country: ['C', 'OR', 'country.id'],
      source: ['S', 'OR', 'source.id'],
      training_language: ['TL', 'OR', 'training_language.id'],
      created: ['DA', 'AND', 'date.created'],
      start: ['DS', 'AND', 'date.start'],
      end: ['DE', 'AND', 'date.end'],
      registration: ['DR', 'AND', 'date.registration'],
      language: ['L', 'OR', 'language.id'],
      source_type: ['ST', 'OR', 'source.type.id']
    }
  };

  // Advanced search operator.
  const operators = {
    '(': 'WITH',
    '!(': 'WITHOUT',
    ')_(': 'AND WITH',
    ')_!(': 'AND WITHOUT',
    ').(': 'OR WITH',
    ').!(': 'OR WITHOUT',
    '.': 'OR',
    '_': 'AND'
  };

  // Advanced parsing pattern.
  const pattern = /(!?\(|\)[._]!?\(|[._])([A-Z]+)(\d+-\d*|-?\d+)/g;

  /**
   * Parse an advanced search date range and return a range object {to, from}.
   */
  function parseDateRange(value) {
    var [from, to] = value.split('-', 2).map((date, index) => {
      if (date) {
        var year = parseInt(date.substr(0, 4), 10);
        var month = parseInt(date.substr(4, 2), 10) - 1;
        var day = parseInt(date.substr(6, 2), 10) + index;
        var utc = Date.UTC(year, month, day, 0, 0, 0);
        return (new Date(utc)).toISOString().replace('.000Z', '+00:00');
      }
      return '';
    });
    return {from: from, to: to};
  }

  /**
   * Parse an advanced search query string into API filters.
   */
  function parseAdvancedQuery(fields, query) {
    if (!query) {
      return null;
    }

    // Map field shortcut to field info.
    var mapping = Object.values(fields).reduce((map, info) => {
      map[info[0]] = {field: info[2], date: info[2].indexOf('date') !== -1};
      return map;
    }, {});

    var root = {
      conditions: [],
      operator: 'AND'
    };
    var filter = null;

    var match = null;
    while ((match = pattern.exec(query)) !== null) {
      var operator = operators[match[1]];
      var info = mapping[match[2]];
      var field = info.field;
      var value = info.date ? parseDateRange(match[3]) : parseInt(match[3], 10);

      // Create the API filter.
      if (operator.indexOf('WITH') !== -1) {
        var newFilter = {
          conditions: [],
          operator: 'AND'
        };

        if (operator.indexOf('OUT') !== -1) {
          newFilter.negate = true;
        }

        // New nested conditional filter.
        operator = operator.indexOf('OR') !== -1 ? 'OR' : 'AND';
        if (operator !== root.operator) {
          root = {
            conditions: [root],
            operator: operator
          };
        }
        root.conditions.push(newFilter);
        filter = root.conditions[root.conditions.length - 1];
      }

      // Add value.
      if (filter) {
        filter.operator = operator;
        filter.conditions.push({field: field, value: value});
      }
    }
    return root.conditions.length > 0 ? root : null;
  }

  /**
   * Reduce nested filters.
   */
  function optimizeFilter(filter) {
    if (filter && filter.conditions) {
      var conditions = [];
      for (var i = 0, l = filter.conditions.length; i < l; i++) {
        var condition = optimizeFilter(filter.conditions[i]);
        if (condition) {
          conditions.push(condition);
        }
      }

      if (conditions.length) {
        conditions = combineConditions(filter.operator, conditions);

        if (conditions.length === 1) {
          var condition = conditions[0];
          if (filter.negate === true) {
            condition.negate = true;
          }
          filter = condition;
        }
        else {
          filter.conditions = conditions;
        }
      }
      else {
        filter = null;
      }
    }
    return filter;
  }

  /**
   * Combine simple filter conditions to shorten the filters.
   */
  function combineConditions(operator, conditions) {
    var filters = {};
    var result = [];

    for (var i = 0, l = conditions.length; i < l; i++) {
      var condition = conditions[i];
      var field = condition.field;
      var value = condition.value;

      // Skip when there are nested conditions or the value is a range.
      if (condition.conditions || typeof value === 'undefined' || (typeof value === 'object' && !Array.isArray(value))) {
        return conditions;
      }

      filters[field] = [].concat(filters[field] || [], value);
    }

    for (const [field, value] of Object.entries(filters)) {
      var filter = {field: field};
      if (value.length === 1) {
        filter.value = value[0];
      }
      else {
        filter.value = value;
        filter.operator = operator;
      }
      result.push(filter);
    }
    return result;
  }

  /**
   * Return the query string representation of an API filter.
   */
  function stringifyFilter(filter) {
    if (!filter) {
      return '';
    }

    var result = '';
    var operator = ' ' + filter.operator + ' ';

    if (filter.conditions) {
      var group = [];
      for (var i = 0, l = filter.conditions.length; i < l; i++) {
        group.push(stringifyFilter(filter.conditions[i]));
      }
      result = '(' + group.join(operator) + ')';
    }
    else if (!filter.value) {
      result = '_exists_:' + filter.field;
    }
    else {
      var value = filter.value;
      if (Array.isArray(value)) {
        value = '(' + value.join(operator) + ')';
      }
      // Date.
      else if (typeof value === 'object') {
        var from = value.from ? value.from.substr(0, 10) : '';
        var to = value.to ? value.to.substr(0, 10) : '';
        if (!from) {
          value = '<' + to;
        }
        else if (!to) {
          value = '>=' + from;
        }
        else {
          value = '[' + from + ' TO ' + to + '}';
        }
      }

      result = filter.field + ':' + value;
    }
    return (filter.negate ? 'NOT ' : '') + result;
  }

  /**
   * Convert facets parameters to an API filter.
   */
  function convertFacets(fields, params) {
    var conditions = [];

    for (var [key, value] of params.entries()) {
      if (fields.hasOwnProperty(key)) {
        var [shortcut, operator, field, values] = fields[key];

        // Date field - parse range format.
        if (field.indexOf('date') !== -1) {
          value = parseDateRange(value);
        }
        // Term reference fields - ensure the term id is an integer.
        else if (field.substr(-3) === '.id') {
          value = value.split('.').map(item => parseInt(item, 10)).filter(item => !isNaN(item));
        }
        // Fixed values fields - ensure the value(s) are in the list.
        else if (values) {
          value = value.split('.').filter(values.includes);
        }
        // Skip unrecognized fields.
        else {
          continue;
        }

        if (value) {
          conditions.push({
            field: field,
            operator: operator,
            value: value
          });
        }
      }
    }
    return conditions.length ? {conditions: conditions, operator: 'AND'} : null;
  }

  /**
   * Remove excessive outer parentheses.
   */
  function trimFilter(filter) {
    return filter.indexOf('(') === 0 ? filter.substr(1, filter.length - 2) : filter;
  }

  /**
   * Get the API query string from the converted search and filter.
   */
  function getQueryString(search, filter) {
    var filters = [
      search ? '(' + search + ')' : '',
      stringifyFilter(filter)
    ].filter(item => item);

    var query = '';
    if (filters.length > 1) {
      query = filters.join(' AND ');
    }
    else if (filters.length === 1) {
      query = trimFilter(filters[0]);
    }
    return query;
  }

  /**
   * Get the API url from the generated query string.
   */
  function getApiUrl(resource, query, appname) {
    var params = [
      'appname=' + encodeURIComponent(appname),
      'profile=list',
      'preset=latest'
    ];
    if (query) {
      params.push('query[value]=' + encodeURIComponent(query));
    }

    return apiUrl + resource + '?' + params.join('&');
  }

  /**
   * Get the JSON payload from the converted search and filter.
   */
  function getJsonPayload(search, filter) {
    var payload = {
      profile: 'list',
      preset: 'latest'
    };
    if (search) {
      payload.query = {value: search};
    }
    if (filter) {
      payload.filter = filter;
    }
    return JSON.stringify(payload, null, '  ');
  }

  /**
   * Get the application name or use a generic one.
   */
  function getAppName() {
    var appname = document.getElementById('appname').value || '';
    return appname.trim() || 'rw-search-converter';
  }

  /**
   * Update the result of the conversion.
   */
  function updateResults(results) {
    for (const [key, value] of Object.entries(results)) {
      var container = document.getElementById('results-' + key);
      var content = document.createTextNode(value || '');
      if (!container.firstChild) {
        container.appendChild(content);
      }
      else {
        container.replaceChild(content, container.firstChild);
      }
    }
  }

  /**
   * Remove the result of the conversion.
   */
  function resetResults() {
    updateResults({query: '', url: '', payload: ''});
  }

  /**
   * Update the current page url with the appname and search url input values.
   */
  function updateCurrentUrl() {
    var url = new URL(window.location.href);
    var params = url.searchParams;
    params.set('appname', document.getElementById('appname').value);
    params.set('search-url', document.getElementById('search-url').value);
    history.pushState({}, 'ReliefWeb Search Converter', url.toString());
  }

  /**
   * Convert a search query to an API query.
   */
  function convertToAPI(url) {
    if (!url) {
      resetResults();
      return;
    }

    var url = new URL(url);
    var params = url.searchParams;
    var path = paths[url.pathname.replace(/^[/]+|[/]+$/g, '')];

    // Skip if the resource couldn't be determined.
    if (!path) {
      resetResults();
      return;
    }

    var resource = path.resource;
    var fields = resources[resource];

    // Application name.
    var appname = getAppName();

    // Search query.
    var search = (params.get('search') || '').trim();

    // Advanced search, facets and resource pre-filter combined filter.
    var filter = optimizeFilter({
      operator: 'AND',
      conditions: [
        parseAdvancedQuery(fields, params.get('advanced-search') || ''),
        convertFacets(fields, params),
        path.filter
      ].filter(item => item)
    });

    // Query string.
    var query = getQueryString(search, filter);

    // API url.
    var url = getApiUrl(resource, query, appname);

    // JSON payload.
    var payload = getJsonPayload(search, filter);

    // Update the results with the conversion.
    updateResults({query, url, payload});
  }

  var form = document.getElementById('to-api-form');
  // Convert the search url on submit.
  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopPropagation();

    // Update current page url.
    updateCurrentUrl();

    // Convert the Search url.
    convertToAPI(document.getElementById('search-url').value);

    return false;
  });
  // Reset the results when the form is resetted.
  form.addEventListener('reset', resetResults);

  // Initialize the fields and convert if there is a search url.
  var params = (new URL(window.location.href)).searchParams;
  document.getElementById('appname').value = params.get('appname') || '';
  document.getElementById('search-url').value = params.get('search-url') || '';
  convertToAPI(document.getElementById('search-url').value);
})();
