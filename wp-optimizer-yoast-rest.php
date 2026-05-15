<?php
/**
 * Registers all standard Yoast SEO meta fields for WordPress REST API access.
 *
 * Installation: copy this file to /wp-content/mu-plugins/wp-optimizer-yoast-rest.php
 *
 * Without this, WordPress silently ignores REST API writes to Yoast fields
 * because Yoast does not register them with show_in_rest = true.
 */
add_action('init', function () {

    $string  = 'string';
    $integer = 'integer';

    $fields = [
        // ── Core SEO ────────────────────────────────────────────────
        '_yoast_wpseo_title'                    => $string,
        '_yoast_wpseo_metadesc'                 => $string,
        '_yoast_wpseo_focuskw'                  => $string,
        '_yoast_wpseo_bctitle'                  => $string,
        '_yoast_wpseo_canonical'                => $string,

        // ── Robots ──────────────────────────────────────────────────
        '_yoast_wpseo_meta-robots-noindex'      => $integer,
        '_yoast_wpseo_meta-robots-nofollow'     => $integer,
        '_yoast_wpseo_meta-robots-adv'          => $string,

        // ── OpenGraph ───────────────────────────────────────────────
        '_yoast_wpseo_opengraph-title'          => $string,
        '_yoast_wpseo_opengraph-description'    => $string,
        '_yoast_wpseo_opengraph-image'          => $string,
        '_yoast_wpseo_opengraph-image-id'       => $string,

        // ── Twitter / X ─────────────────────────────────────────────
        '_yoast_wpseo_twitter-title'            => $string,
        '_yoast_wpseo_twitter-description'      => $string,
        '_yoast_wpseo_twitter-image'            => $string,
        '_yoast_wpseo_twitter-image-id'         => $string,

        // ── Scores & flags ──────────────────────────────────────────
        '_yoast_wpseo_linkdex'                  => $integer,
        '_yoast_wpseo_content_score'            => $integer,
        '_yoast_wpseo_inclusive-language-score' => $integer,
        '_yoast_wpseo_is_cornerstone'           => $integer,
        '_yoast_wpseo_estimated-reading-time-minutes' => $integer,
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
