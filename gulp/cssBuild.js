var paths = require('./config').paths;

var gulp = require('gulp');
var gutil = require('gulp-util');
var autoprefixer = require('gulp-autoprefixer');
var gulpFilter = require('gulp-filter');
var concat = require('gulp-concat');
var cssnano = require('gulp-cssnano');

exports.getDev = function (srcs) {
  srcs = srcs || paths.css;

  return function dev() {
    return gulp.src(srcs, {base: paths.app})
      .pipe(autoprefixer())
      .pipe(gulp.dest(paths.dest))
      .on('end', function(){
        gutil.log(gutil.colors.green('✔ CSS build'), 'Finished');
      });
  };
};
