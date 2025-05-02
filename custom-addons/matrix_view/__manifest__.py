{
    'name': 'Matrix View',
    'version': '17.0.1.0.0',
    'depends': ['web'],
    'assets': {
        'web.assets_backend': [
            'matrix_view/static/src/*.js',
            'matrix_view/static/src/*.xml',
            #'matrix_view/static/src/css/*.css',
            'matrix_view/static/src/*.scss',
        ],
    },
    'installable': True,
}