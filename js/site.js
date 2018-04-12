(function () {
  'use strict';

  const apiUrl = 'https://api.reliefweb.int/v1/';

  // TODO: add other resources.
  const resources = {
    updates: {
      resource: 'reports',
      fields: {
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
      }
    }
  };

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
        return (new Date(utc)).toISOString().substr(0, 10);
      }
      return '';
    });
    return {from: from, to: to};
  }

  /**
   * Parse an advanced search query string into API filters.
   */
  function parseAdvancedQuery(resource, query) {
    if (!query) {
      return null;
    }

    // Map field shortcut to field info.
    var mapping = Object.values(resource.fields).reduce((map, info) => {
      map[info[0]] = {field: info[2], date: info[2].indexOf('date') !== -1};
      return map;
    }, {});

    var root = {
      conditions: [],
      operator: 'AND'
    };
    var filter = null;

    var match;
    while (match = pattern.exec(query)) {
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
      var negation = condition.negate === true ? '1' : '0';
      var field = condition.field + '#' + negation;
      var value = condition.value;

      // Nested conditions, skip.
      if (condition.conditions) {
        return conditions;
      }

      if (Number.isInteger(value) || Array.isArray(value)) {
        filters[field] = [].concat(filters[field] || [], value);
      }
    };

    for (const [key, value] of Object.entries(filters)) {
      var [field, negation] = key.split('#', 2);
      var filter = {field: field};
      if (value.length === 1) {
        filter.value = value[0];
      }
      else {
        filter.value = value;
        filter.operator = operator;
      }
      if (negation === '1') {
        filter.negate = true;
      }
      result.push(filter);
    }
    return result;
  }

  /**
   * Return the query string represenation of an API filter.
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
    else {
      var value = filter.value;
      if (Array.isArray(value)) {
        value = '(' + value.join(operator) + ')';
      }
      // Date.
      else if (typeof value === 'object') {
        if (!value.from) {
          value = '<' + value.to;
        }
        else if (!value.to) {
          value = '>=' + value.from;
        }
        else {
          value = '[' + value.from + ' TO ' + value.to + '}';
        }
      }

      result = filter.field + ':' + value;
    }
    return (filter.negate ? 'NOT ' : '') + result;
  }

  /**
   * Convert facets parameters to an API filter.
   */
  function convertFacets(resource, params) {
    var conditions = [];
    var fields = resource.fields;

    for (var [key, value] of params.entries()) {
      if (fields.hasOwnProperty(key)) {
        var [shortcut, operator, field] = fields[key];

        if (field.indexOf('date') !== -1) {
          value = parseDateRange(value);
        }
        else {
          value = value.split('.').map(item => parseInt(item, 10));
        }

        conditions.push({
          field: field,
          operator: operator,
          value: value,
        });
      }
    }
    return conditions.length ? {conditions: conditions, operator: 'AND'} : null;
  }

  /**
   * Remove excessive outer parantheses.
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
      'preset=latest',
      'query[value]=' + encodeURIComponent(query)
    ].join('&');

    return apiUrl + resource.resource + '?' + params;
  }

  /**
   * Get the JSON payload from the converted search and filter.
   */
  function getJsonPayload(search, filter, appname) {
    var payload = {
      appname: appname,
      profile: 'list',
      preset: 'latest',
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
    return appname.replace(/[^a-z._-]/gi, '') || 'rw-search-converter';
  }

  /**
   * Update the result of the conversion.
   */
  function updateResults(results) {
    for (const [key, value]  of Object.entries(results)) {
      var container = document.getElementById('results-' + key);
      var content = document.createTextNode(value);
      if (!container.firstChild) {
        container.appendChild(content);
      }
      else {
        container.replaceChild(content, container.firstChild);
      }
    }
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
      return;
    }

    var url = new URL(url);
    var params = url.searchParams;
    var resource = resources[url.pathname.replace(/^[/]+|[/]+$/g, '')];

    // Skip if the resource couldn't be determined.
    if (!resource) {
      return;
    }

    // Application name.
    var appname = getAppName();

    // Search query.
    var search = (params.get('search') || '').trim();

    // Advanced search and facets combined filter.
    var filter = optimizeFilter({
      operator: 'AND',
      conditions: [
        parseAdvancedQuery(resource, params.get('advanced-search') || ''),
        convertFacets(resource, params)
      ].filter(item => item)
    });

    // Query string.
    var query = getQueryString(search, filter);

    // API url.
    var url = getApiUrl(resource, query, document.getElementById('appname').value);

    // JSON payload.
    var payload = getJsonPayload(search, filter, appname);

    // Update the results with the conversion.
    updateResults({query, url, payload});
  }

  // Convert the search url on submit.
  document.getElementById('to-api-form').addEventListener('submit', event => {
    event.preventDefault();
    event.stopPropagation();

    // Update current page url.
    updateCurrentUrl();

    // Convert the Search url.
    convertToAPI(document.getElementById('search-url').value);

    return false;
  });

  // Initialize the fields and convert if there is a search url.
  var params = (new URL(window.location.href)).searchParams;
  document.getElementById('appname').value = params.get('appname') || '';
  document.getElementById('search-url').value = params.get('search-url') || '';
  convertToAPI(document.getElementById('search-url').value);
})();
