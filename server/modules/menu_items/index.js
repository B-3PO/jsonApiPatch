function initTypes(dataManager) {
  dataManager.addType({
    name: 'menuItems',
    table: 'menu_items',
    constraint: true,
    attributes: {
      name: {dataType: dataManager.dataType.STRING},
      description: {dataType: dataManager.dataType.STRING},
      price: {
        dataType: dataManager.dataType.CURRENCY,
        // to dollar from pennies 2 decimal
        format: function (data) {
          return parseFloat((data/100).toFixed(2));
        },

        // to pennies from dallow
        parse: function (data) {
          return parseFloat(parseFloat(data) * 100).toPrecision(12) | 0;
        }
      }
    }
  });
}



function addRoutes(app, dataManager) {
  app.use('/menuItems', dataManager.CreateResource({
    name: 'menuItems',
    type: 'menuItems'
  }));
}


module.exports = function(app, dataManager) {
	initTypes(dataManager);

	return {
    initRoutes: initRoutes
  };

  function initRoutes() {
    addRoutes(app, dataManager);
  }
};
