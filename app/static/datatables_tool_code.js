// datatables-tool.js

var handle_ajax_error = function(jqXHR, textStatus, errorThrown) {
  $('#content > .dataTables_processing').remove()
  if (jqXHR.responseText.match(/database file does not exist/) != null) {
    $('#table-sidebar-loading').text('No tables')
    $('#content').html('<div class="problem"><h4>This dataset is empty.</h4>' +
                       '<p>Once your dataset contains data,<br/>' +
                       'it will show up in a table here.</p></div>')

  } else if (jqXHR.responseText.match(/Gateway Time-out/) != null) {
    $('#content').html('<div class="problem"><h4>Well this is embarassing.</h4>' +
                       '<p>Your dataset is too big to display.</br>' +
                       'Try downloading it as a spreadsheet.</p></div>')

  } else {
    scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
  }
}

// http://stackoverflow.com/questions/7740567/escape-markup-in-json-driven-jquery-datatable
function htmlEncode(value) {
  return $('<div/>').text(value).html();
}

function htmlDecode(value) {
  return $('<div/>').html(value).text();
}

function pluralise(number, plural_suffix, singular_suffix) {
  var plural_suffix = plural_suffix || 's';
  var singular_suffix = singular_suffix || '';

  if (number == 1) {
    return singular_suffix;
  } else {
    return plural_suffix;
  }
}

// Links clickable etc. in one row of data
var prettifyCell = function(content) {
  content = $.trim(content)

  var escaped_content = htmlEncode(content)

  // convert images to themselves embedded.
  // XXX _normal is to match Twitter images, watch for it causing trouble
  // e.g. https://si0.twimg.com/profile_images/2559953209/pM981LrS_normal - remove it
  if (content.match(/^((http|https|ftp):\/\/[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+(\.jpeg|\.png|\.jpg|\.gif|\.bmp|_normal))$/ig)
      // This isn't an image, despite the extension: http://en.m.wikipedia.org/wiki/File:Violette_Leduc.jpg
      && !content.match(/wikipedia.org\/wiki\//)
     ) {
    content = '<img src="' + escaped_content + '" class="inline">'
  }
  // match LinkedIn image URLs, which always have "licdn.com/mpr/mpr" in them.
  // e.g. http://m3.licdn.com/mpr/mprx/0_oCf8SHoyvJ0Wq_CEo87xSEoAvRHIq5CEe_R0SEw2EOpRI3voQk0uio0GUveqBC_QITDYCDvcT0rm
  else if (content.match(/^((http|https|ftp):\/\/[a-z0-9\.]+licdn.com\/mpr\/mpr[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+)$/ig)) {
    content = '<img src="' + escaped_content + '" class="inline">'
  }
  // add links onto URLs:
  else if (content.match(/^((http|https|ftp):\/\/[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+)$/g)) {
    var less_30 = escaped_content
    if (content.length > 30) {
      less_30 = htmlEncode(content.substr(0,30)) + "&hellip;"
    }
    content = '<a href="' + escaped_content + '" target="_blank">' + less_30 + '</a>'
  }
  else {
    var less_500 = escaped_content
    if (content.length > 500) {
      less_500 = htmlEncode(content.substr(0,500)) +
        "<span title='" + content.length + " characters in total'>&hellip;</span>"
    }
    content = less_500
  }

  return content
}

// Save known state of all tabs, and active tab.
// oSettings is ignored (it's only there because DataTables provides it)
// oData should either be a DataTables object, or null (in the case of a grid)
var saveState = function(oSettings, oData) {
  window.allSettings['active'] = window.currentActiveTable
  window.allSettings['activeType'] = window.currentActiveTableType
  window.allSettings['tables'][window.currentActiveTable] = oData
  localStorage.setItem( 'DataTables_'+window.location.pathname, JSON.stringify(window.allSettings) );
}

// Restore column status from the view's box's filesystem.
var loadState = function(oSettings) {
  if (window.currentActiveTable in window.allSettings['tables']) {
    oData = window.allSettings['tables'][window.currentActiveTable]
    // Force the display length we calculated was suitable when first
    // making the table (rather than using the saved setting).
    oData.iLength = oSettings._iDisplayLength
    // Force to first page, as confuses users
    oData.iStart = 0
    oData.iEnd = 0
  } else {
    oData = false
 }
  return oData
}

// Escape identifiers
var escapeSQL = function(column_name) {
  return '"' + column_name.replace(/"/g, '""') + '"'
}
var escapeshell = function(cmd) {
  return "'" + cmd.replace(/'/g,"'\\''") + "'";
}

// Function to map JSON data between DataTables format and ScraperWiki's SQL
// endpoint format. It returns a function for the fnServerData parameter.
var convertData = function(table_name, column_names) {
  // This is a wrapper round the GET request DataTables makes to get more data
  // sSource - the URL, we don't use it, we hard code it instead
  // aoData - contains the URL parameters, e.g. what page, what to filter, what
  //          order and so on
  // fnCallback - where to call with the data you get back
  // oSettings - settings object for the whole DataTables,
  // see http://datatables.net/docs/DataTables/1.9.0/DataTable.models.oSettings.html
  return function(sSource, aoData, fnCallback, oSettings) {
    // convert aoData into a normal hash (called ps)
    var params = {}
    for (var i = 0; i < aoData.length; i++) {
      params[aoData[i].name] = aoData[i].value
    }

    // construct SQL query needed according to the parameters
    var order_by = ""
    if (params.iSortingCols >= 1) {
      var order_parts = []
      for (var i = 0; i < params.iSortingCols; i++) {
        order_part = escapeSQL(column_names[params["iSortCol_" + i]])
        if (params["sSortDir_" + i] == 'desc') {
          order_part += " desc"
        } else if (params["sSortDir_" + i] != 'asc') {
          scraperwiki.alert("Got unknown sSortDir_" + i +
                            " value in table " + table_name)
        }
        order_parts.push(order_part)
      }
      order_by = " order by " + order_parts.join(",")
    }

    var where = ""
    if (params.sSearch) {
      var search = "'%" + params.sSearch.toLowerCase()
                          .replace("%", "$%")
                          .replace("_", "$_")
                          .replace("$", "$$") + "%'"

      where = " where " + _.map(column_names, function(n) {
        return "lower(" + escapeSQL(n) + ") like " + search + " escape '$'"
      }).join(" or ")

      if (where.length > 1500) {
        scraperwiki.alert("Filtering is unavailable.",
                          "Your dataset has too many columns")
        $(".search-query").val("").trigger("keyup")
        return
      }
    }

    var query = "*" +
                " from " + escapeSQL(table_name) +
                where +
                order_by +
                " limit " + params.iDisplayLength +
                " offset " + params.iDisplayStart

    var counts
    var getColumnCounts = function(cb) {
      select(
        "(select count(*) from " + escapeSQL(table_name) + ") as total, " +
        "(select count(*) from " + escapeSQL(table_name) + where + ") as display_total").done(function(data) {
          counts = data[0]
          cb()
        }).fail(function(jqXHR, textStatus, errorThrown) {
          handle_ajax_error(jqXHR, textStatus, errorThrown)
          cb()
        })
    }

    var rows = []
    var getRows = function(cb) {
      select(query).done(function(data) {
          // ScraperWiki returns a list of dicts.
          // This converts it to a list of lists.
          for (var i = 0; i < data.length; i++) {
            var row = []
            _.each(window.meta.table[table_name].columnNames, function(col) {
              row.push(prettifyCell(data[i][col]))
            })
            rows.push(row)
          }
          cb()
        }).fail(function(jqXHR, textStatus, errorThrown) {
          handle_ajax_error(jqXHR, textStatus, errorThrown)
          cb()
        })
    }

    var populateDataTable = function() {
      fnCallback({
        "aaData" : rows,
        "iTotalRecords": counts.total, // without filtering
        "iTotalDisplayRecords": counts.display_total // after filtering
      })
    }
    async.parallel([getColumnCounts, getRows], populateDataTable)
  }
}

// Make one of the DataTables (in one tab)
// 'table_type' should be either 'table' or 'grid'
// 'table_index' should be the integer position of the datatable
//               in the list of all tables/grids
// 'table_name' is obviously the SQL table name, or the grid checksum
var showTable = function(table_type, table_index, table_name) {
    constructDataTable(table_type, table_index, table_name)
  }


var hidePreviousTable = function() {
  $(".maintable:visible").hide()
}


// Given $table, a <table> element on the page,
// fill the table with data and make it into an
// interactive DataTables.js table.
var constructDataTable = function(table_type, table_index, table_name) {

  // Show table if it exists already
  var wrapper_id = table_type + "_" + table_index
  var $outer = $("#" + wrapper_id)
  if($outer.length){
    hidePreviousTable()
    $outer.show()
    return
  }

  // Table doesn't exist, so create it
  var column_names = window.meta.table[table_name].columnNames
  if (column_names.length == 0) {
    scraperwiki.alert("No columns in the table", jqXHR.responseText)
    return
  }

  hidePreviousTable()
  var $outer = $('<div class="maintable" id="' + wrapper_id + '">' +
                 '<table class="table table-striped table-bordered innertable display"></table>' +
                 '</div>')
  $('#content').append($outer)
  var $table = $outer.find('table')

  // Make the column headings
  var thead = '<thead><tr>'
  _.each(column_names, function(column_name) {
    thead += '<th>' + column_name + '</th>'
  })
  thead += '</tr></thead>'
  $table.append(thead)

  // Show fewer rows the more columns there are (for large tables to load quicker)
  var num_columns = column_names.length
  var rows_to_show = 500
  if (num_columns >= 10) {
    rows_to_show = 250
  }
  if (num_columns >= 20) {
    rows_to_show = 100
  }
  if (num_columns >= 40) {
    rows_to_show = 50
  }

  var initComplete = function(oSettings) {
    if (oSettings.aoColumns.length > 30) {
      // Remove search box if there are so many columns the ajax request
      // would cause a 414 Request URI Too Large error on wide datasets
      $('#' + wrapper_id + ' .input-append').empty()

    } else {
      // Otherwise, append search box and handle clicks / enter key
      var $btn = $('<button class="btn">Search</button>')
      $btn.on('click', function() {
        searchTerm = $(this).prev().val()
        window.currentTable.fnFilter(searchTerm)
      })

      var $input = $('<input type="search" class="input-medium search-query">')
      $input.on('keypress', function(e) {
        if (e.which === 13) {
          $(this).next().trigger('click')
        }
      })

      if (oSettings.oLoadedState != null) {
        $input.val(oSettings.oLoadedState.oSearch.sSearch)
      }

      $('#' + wrapper_id + ' .input-append').html($input).append($btn)
    }
  }

  // Fill in the datatables object
  window.currentTable = $table.dataTable({
    "bProcessing": true,
    "bServerSide": true,
    "bDeferRender": true,
    "bPaginate": true,
    "bFilter": true,
    "iDisplayLength": rows_to_show,
    "bScrollCollapse": true,
    "sDom": 'r<"table_controls"p<"form-search"<"input-append">>i><"table_wrapper"t>',
    "sPaginationType": "bootstrap",
    "fnServerData": convertData(table_name, column_names),
    "fnInitComplete": initComplete,
    "bStateSave": true,
    "fnStateSave": saveState,
    "fnStateLoad": loadState,
    "oLanguage": {
      "sEmptyTable": "This table is empty"
     }
  })
}

// Create and insert spreadsheet-like tab bar at top of page.
// 'tables' should be a list of table names.
// 'active_table' should be the one you want to appear selected.
var constructTabs = function(active_table) {
  var $nav = $('nav').empty()

  // Remove "loading tables..."
  $('#table-sidebar > ul.nav').hide()

  var constructTab = function(type, table_index, table_name, active_table) {
    var $li = $('<li>')

    if (table_name == active_table) {
      $li.addClass('active')
      window.currentActiveTable = table_name
      window.currentActiveTableIndex = table_index
      window.currentActiveTableType = type
    }

    var $a = $('<a>').appendTo($li)

    $a.text(table_name)
    $a.attr('data-table-index', table_index)
    $a.attr('data-table-name', table_name)
    $a.attr('data-table-type', type)

    return $li
  }

  var populateTabs = function(tables, type, heading_name) {
    if (tables.length == 0) {
      return $([])
    }

    var subtitle = tables.length + ' ' + heading_name + pluralise(tables.length)
    var $ul = $('<ul class="nav nav-list">')
    $nav.append($ul)

    $ul.append('<li class="nav-header">' + subtitle + '</li>')

    $.each(tables, function(i, table_name) {
      var i = window.tables.indexOf(table_name)
      var tab = constructTab(type, i, table_name, active_table)
      $ul.append(tab)
    })

    return $ul
  }

  var publicTables = _.filter(window.tables, isPublicTable)
  populateTabs(publicTables, 'table', 'Table')

  var devTables = _.filter(window.tables, isDevTable)
  var devUl = populateTabs(devTables, 'table', 'Developer table')
  devUl.attr('id', 'developer-tables')
  devUl.find('li:not(.nav-header)').addClass('developer')
}

// Short functions to weed out non-user-facing tables
var isHiddenTable = function(table_name) {
  return table_name.slice(0, 2) == '__'
}

var isDevTable = function(table_name) {
  return table_name.slice(0, 1) == '_' && !isHiddenTable(table_name)
}

var isPublicTable = function(table_name) {
  return table_name.slice(0, 1) != '_'
}

// Make all the DataTables and their tabs
var constructDataTables = function(first_table_name) {

  var all_tables = window.tables
  var have_first_table = first_table_name &&
                         _.contains(all_tables, first_table_name)

  if (!have_first_table) {
    // Get the first non underscore table if there is one, or the first
    // table overall
    first_table_name = _.reject(all_tables, isDevTable)[0] ||
                       window.tables[0]
  }

  // Populate the sidebar
  constructTabs(first_table_name)

  if (isDevTable(first_table_name)) {
    toggleDevTables()
  }
}

// Get table names in the right order, ready for display
var filterAndSortTables = function(messyTableNames) {
  // Filter out tables starting with double underscore
  var niceTables = _.reject(messyTableNames, isHiddenTable)
  // Put tables beginning with a single underscore at the end
  var topTables = _.reject(niceTables, isDevTable)
  var bottomTables = _.filter(niceTables, isDevTable)
  return topTables.concat(bottomTables)
}


var toggleDevTables = function() {
  $('#developer-tables .nav-header').nextAll().toggle()
  // force the sidebar to scroll right to the bottom,
  // to show the newly unhidden dev tables
  $('#table-sidebar').scrollTop(99999)
}

// Main entry point
var tables // list of table names
var currentActiveTable
var currentActiveTableIndex
var currentActiveTableType
var db
var selectEndpoint

var select = function(query) {
  var options;
  options = {
    url: window.selectEndpoint,
    type: "GET",
    dataType: "json",
    data: { q: query, }
  };
  return $.ajax(options);
}

var meta = function() {
  /* Modified from scraperwiki.coffee */
  var options;
  options = {
    url: window.metaEndpoint,
    type: "GET",
    dataType: "json",
  };
  return $.ajax(options);
};

$(function() {
  /* Can't replace with a local URL until cgi-bin running locally. */
  window.selectEndpoint =  '../sql_backend/select'
  window.metaEndpoint = '../sql_backend/meta'
  var fetchSQLMeta = function (cb) {
      meta().done(function(newMeta) {
        window.meta = newMeta
        window.tables = filterAndSortTables(_.keys(window.meta.table))
        cb()
      }).fail(function(jqXHR, textStatus, errorThrown) {
        handle_ajax_error(jqXHR, textStatus, errorThrown)
        cb()
    })
  }

  var loadAllSettings = function(cb) {
    var oData = false
    var content = localStorage.getItem('DataTables_'+window.location.pathname)
    window.allSettings = { tables: {}, active: null, activeType: null }
    if (content != null) {
      try {
        window.allSettings = JSON.parse(content)
      } catch (e) {
        // Deliberately empty.
      }
    }
    cb()
  }

  var whenLoaded = function (err, results) {
    $('#content > .dataTables_processing').remove()

    if (window.tables.length) {
        window.currentActiveTable = window.allSettings['active']

        if (window.currentActiveTable &&
            isDevTable(window.currentActiveTable)) {
          // we don't want to automatically switch to _ tables
          // so we pretend the state was never saved
          window.currentActiveTable = undefined
        }

        constructDataTables(window.currentActiveTable)

        // Activate one of the sidebar tables (This is really hacky)
        // These global variables are set in constructTab
        $('a[data-table-index="' + window.currentActiveTableIndex + '"]'+
           '[data-table-type="' + window.currentActiveTableType + '"]'+
           '[data-table-name="' + window.currentActiveTable + '"]')
        .trigger('click')

    } else {
      $('#table-sidebar-loading').text('No tables')
      $('#content').html(
        '<div class="problem"><h4>This dataset is empty.</h4>' +
        '<p>Once your dataset contains data,<br/>' +
        'it will show up in a table here.</p></div>')
    }
  }

  async.parallel([fetchSQLMeta, loadAllSettings], whenLoaded)

  // Handle sidebar tab clicks
  $(document).on('click', '#table-sidebar li a', function(e) {
    e.preventDefault()
    var $a = $(this)
    var $li = $a.parent()
    var $nav = $('#table-sidebar')

    $nav.find('li.active').removeClass('active')
    $li.addClass('active')

    window.currentActiveTable = $a.attr('data-table-name')
    window.currentActiveTableIndex = $a.attr('data-table-index')
    window.currentActiveTableType = $a.attr('data-table-type')

    showTable(window.currentActiveTableType,
              window.currentActiveTableIndex,
              window.currentActiveTable)
  })

  $(document).on('click', '#developer-tables .nav-header', toggleDevTables)

  // The "activate" event is produced when scrollspy selects
  // a new sidebar tab because a user has scrolled in #content
  $(document).on('activate', function(e){
    var $nav = $('#table-sidebar')

    if($nav.is(':hover')){
      return // Don't want to move links under the user's cursor!
    }

    var $li = $(e.target)
    var target_y = $li.position().top
    target_y += $nav.scrollTop()
    target_y -= $nav.height() / 2
    target_y += $li.height() / 2
    $nav.scrollTop(target_y - 20)
  })

  $('#table-sidebar').on('mouseleave', function(){
    var $nav = $(this)
    var $li = $('.active', $nav)
    if($li.length){ // just in case sidebar is empty
      var target_y = $li.position().top
      target_y += $nav.scrollTop()
      target_y -= $nav.height() / 2
      target_y += $li.height() / 2
      window.sidebarScrollTimeout = setTimeout(function(){
        $nav.animate({ scrollTop: target_y - 20 }, 500)
      }, 1000)
    }
  }).on('mouseenter', function(){
    clearTimeout(window.sidebarScrollTimeout)
  })

});
