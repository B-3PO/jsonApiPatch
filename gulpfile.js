var paths = require('./gulp/config').paths;

var gulp = require('gulp');
var nodemon = require('gulp-nodemon');
var gulpSequence = require('gulp-sequence');
var del = require('del');


var jsBuild = require('./gulp/jsBuild');
var cssBuild = require('./gulp/cssBuild');
var indexBuild = require('./gulp/indexBuild');



gulp.task('jsBuild', jsBuild.getDev());
gulp.task('cssBuild', cssBuild.getDev());
gulp.task('indexBuild', indexBuild.inject);



// -- main tasks. use these to watch and build and release

gulp.task('default', gulpSequence('build', ['nodemon', 'watch']));

gulp.task('build', gulpSequence(
  'clean',
  [
    'jsBuild',
    'cssBuild',
    'copyPartials',
    'copyModules',
    'copyFont'
  ],
  'indexBuild'
));



gulp.task('clean', function () {
  return del(paths.dest);
});


gulp.task('copyPartials', function () {
  return gulp.src(paths.partials, {base: paths.app})
    .pipe(gulp.dest(paths.dest));
});

gulp.task('copyModules', function () {
  return gulp.src(paths.moduleScripts.concat(paths.moduleCss), {base: paths.app})
    .pipe(gulp.dest(paths.dest + 'devModules/'));
});


gulp.task('copyFont', function () {
  return gulp.src(paths.font)
    .pipe(gulp.dest(paths.dest + 'devModules/brmaterial/'));
});


gulp.task('nodemon', function () {
  nodemon({
    script: 'server/server.js',
    ignore: ['app/', 'gulp/', 'devModules/', 'public/']
  });
});





gulp.task('watch', function () {
  gulp.watch(paths.scripts, function (event) {
    jsBuild.getDev(event.path)()
      .on('end', function () {
        if (event.type !== 'changed') { indexBuild.inject(); }
      });
  });


  gulp.watch(paths.css, function (event) {
    cssBuild.getDev(event.path)()
      .on('end', function () {
        if (event.type !== 'changed') { indexBuild.inject(); }
      });
  });


  gulp.watch(paths.partials, function (event) {
    return gulp.src(event.path, {base: paths.app})
      .pipe(gulp.dest(paths.dest));
  });
});
