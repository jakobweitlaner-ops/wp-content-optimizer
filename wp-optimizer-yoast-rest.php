<?php
/**
 * Registers all standard Yoast SEO meta fields for WordPress REST API access,
 * and provides a custom endpoint for in-place image replacement.
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

// ── In-place image replacement endpoint ─────────────────────────────────────
//
// POST /wp-json/wp-optimizer/v1/media/{id}/replace
// Headers: Content-Type: image/jpeg   (or image/png, image/webp)
// Body:    raw binary of the compressed image
//
// Overwrites the existing file on disk, regenerates all thumbnail sizes, and
// clears caches — the media ID and all post references remain unchanged.

add_action('rest_api_init', function () {
    register_rest_route('wp-optimizer/v1', '/media/(?P<id>\d+)/replace', [
        'methods'             => 'POST',
        'callback'            => '_wp_optimizer_replace_media',
        'permission_callback' => function () {
            return current_user_can('upload_files');
        },
        'args' => [
            'id' => [
                'required'          => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && intval($param) > 0;
                },
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);
});

function _wp_optimizer_replace_media(WP_REST_Request $request) {
    $attachment_id = $request->get_param('id');

    $attachment = get_post($attachment_id);
    if (!$attachment || $attachment->post_type !== 'attachment') {
        return new WP_Error('not_found', 'Attachment not found.', ['status' => 404]);
    }

    $body = $request->get_body();
    if (empty($body)) {
        return new WP_Error('empty_body', 'No file data in request body.', ['status' => 400]);
    }

    // Resolve and validate content type
    $content_type = strtolower(trim(explode(';', $request->get_header('Content-Type') ?? '')[0]));
    $allowed_types = [
        'image/jpeg' => 'jpg',
        'image/jpg'  => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
    ];
    if (!isset($allowed_types[$content_type])) {
        return new WP_Error(
            'unsupported_type',
            'Unsupported Content-Type: ' . esc_html($content_type),
            ['status' => 415]
        );
    }
    $new_ext = $allowed_types[$content_type];

    // Resolve current file path from the database (not from user input)
    $current_path = get_attached_file($attachment_id);
    if (!$current_path || !file_exists($current_path)) {
        return new WP_Error('file_not_found', 'Attachment file not found on disk.', ['status' => 500]);
    }

    $current_ext = strtolower(pathinfo($current_path, PATHINFO_EXTENSION));
    $upload_dir  = dirname($current_path);

    // If format changed (e.g. PNG → WebP), build new path with updated extension
    if ($current_ext !== $new_ext) {
        $new_path = $upload_dir . '/' . pathinfo($current_path, PATHINFO_FILENAME) . '.' . $new_ext;
    } else {
        $new_path = $current_path;
    }

    // Delete existing thumbnail files before overwriting
    $old_meta = wp_get_attachment_metadata($attachment_id);
    if (!empty($old_meta['sizes']) && is_array($old_meta['sizes'])) {
        foreach ($old_meta['sizes'] as $size_data) {
            $thumb = $upload_dir . '/' . $size_data['file'];
            if (file_exists($thumb)) {
                wp_delete_file($thumb);
            }
        }
    }

    // WordPress "big image" handling:
    // When a large image is uploaded, WP keeps the original (e.g. image.jpg) and creates a
    // scaled version (image-scaled.jpg). If the uncompressed original still exists on disk,
    // wp_generate_attachment_metadata() will re-scale from it and overwrite our compressed file.
    // Fix: also write the compressed buffer to the original file so WP has nothing large to
    // re-scale from. Preserve the original_image metadata key so references stay intact.
    $original_image_filename = !empty($old_meta['original_image']) ? $old_meta['original_image'] : null;
    if ($original_image_filename && $current_ext === $new_ext) {
        $original_path = $upload_dir . '/' . $original_image_filename;
        if (file_exists($original_path)) {
            file_put_contents($original_path, $body);
        }
    }

    // Write the new binary to disk
    $bytes = file_put_contents($new_path, $body);
    if ($bytes === false) {
        return new WP_Error('write_failed', 'Could not write file to disk.', ['status' => 500]);
    }

    // If path changed, remove old file and update WP's file reference
    if ($new_path !== $current_path) {
        wp_delete_file($current_path);
        update_attached_file($attachment_id, $new_path);
        wp_update_post([
            'ID'             => $attachment_id,
            'post_mime_type' => $content_type,
        ]);
    }

    // Regenerate attachment metadata (dimensions, thumbnails)
    require_once ABSPATH . 'wp-admin/includes/image.php';
    $new_meta = wp_generate_attachment_metadata($attachment_id, $new_path);

    // Preserve the original_image reference so WP's big-image APIs keep working
    if ($original_image_filename && $current_ext === $new_ext) {
        $new_meta['original_image'] = $original_image_filename;
    }

    wp_update_attachment_metadata($attachment_id, $new_meta);

    // Clear all caches for this attachment
    clean_attachment_cache($attachment_id);
    wp_cache_delete($attachment_id, 'posts');

    return rest_ensure_response([
        'id'          => $attachment_id,
        'source_url'  => wp_get_attachment_url($attachment_id),
        'mime_type'   => get_post_mime_type($attachment_id),
        'filesize'    => $bytes,
        'replaced_in_place' => true,
    ]);
}
