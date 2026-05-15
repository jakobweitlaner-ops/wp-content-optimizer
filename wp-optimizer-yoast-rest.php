<?php
/**
 * Registers Yoast SEO meta fields for WordPress REST API access.
 *
 * Installation: copy this file to /wp-content/mu-plugins/wp-optimizer-yoast-rest.php
 *
 * Without this, WordPress silently ignores writes to Yoast fields via the
 * REST API because they are not registered with show_in_rest = true.
 */
add_action('init', function () {
    $fields = [
        '_yoast_wpseo_title'               => 'string',
        '_yoast_wpseo_metadesc'            => 'string',
        '_yoast_wpseo_meta-robots-noindex' => 'integer',
        '_yoast_wpseo_meta-robots-nofollow'=> 'integer',
    ];

    foreach (['post', 'page'] as $post_type) {
        foreach ($fields as $key => $type) {
            register_post_meta($post_type, $key, [
                'show_in_rest'  => true,
                'single'        => true,
                'type'          => $type,
                'auth_callback' => function () {
                    return current_user_can('edit_posts');
                },
            ]);
        }
    }
});
