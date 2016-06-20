angular
  .module('jsonApiPatch',
  [
    'ngRoute',
    'ngMessages',
    'ngAnimate',
    'brMaterial',
    'jsonApiManager',
  ])
  .config(configApp);




configApp.$inject = ['$routeProvider'];
function configApp($routeProvider) {
  $routeProvider
    .when('/', {
      templateUrl: 'sections/home/home.html',
      controller: 'HomeController',
      controllerAs: 'vm'
    })
    .otherwise('/');
}
