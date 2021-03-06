// Handle preloading images.
//
// If we have a reasonably fast connection and the site is keeping up, we can just preload
// blindly and let the browser figure out priorities.  However, if we preload too aggressively
// for the connection and loads start to back up, it can cause image loading to become delayed.
// For example, if we preload 100 manga page images, and then back out of the page and want to
// view something else, the browser won't load anything else until those images that we no
// longer need finish loading.
//
// image_preloader is told the illust_id that we're currently showing, and the ID that we want
// to speculatively load.  We'll run loads in parallel, giving the current image's resources
// priority and cancelling loads when they're no longer needed.
//
// This doesn't handle thumbnail preloading.  Those are small and don't really need to be
// cancelled, and since we don't fill the browser's load queue here, we shouldn't prevent
// thumbnails from being able to load.

// A base class for fetching a single resource:
class _preloader
{
    // Cancel the fetch.
    cancel()
    {
        if(this.abort_controller == null)
            return;

        this.abort_controller.abort();
        this.abort_controller = null;
    }
}

// Load a single image with <img>:
class _img_preloader extends _preloader
{
    constructor(url)
    {
        super();
        this.url = url;
    }

    // Start the fetch.  This should only be called once.
    async start()
    {
        this.abort_controller = new AbortController();
        await helpers.decode_image(this.url, this.abort_controller.signal);
    }
}

// Load a resource with XHR.  We rely on helpers.fetch_resource to make concurrent
// loads with zip_image_player work cleanly.
class _xhr_preloader extends _preloader
{
    constructor(url)
    {
        super();
        this.url = url;
    }

    async start()
    {
        this.abort_controller = new AbortController();
        await helpers.fetch_resource(this.url, {
            signal: this.abort_controller.signal,
        });
    }
}

// The image preloader singleton.
class image_preloader
{
    // Return the singleton, creating it if needed.
    static get singleton()
    {
        if(image_preloader._singleton == null)
            image_preloader._singleton = new image_preloader();
        return image_preloader._singleton;
    };

    constructor()
    {
        // The _preloader objects that we're currently running.
        this.preloads = [];

        // A queue of URLs that we've finished preloading recently.  We use this to tell if
        // we don't need to run a preload.
        this.recently_preloaded_urls = [];
    }

    // Set the illust_id the user is currently viewing.  If illust_id is null, the user isn't
    // viewing an image (eg. currently viewing thumbnails).
    async set_current_image(illust_id)
    {
        if(this.current_illust_id == illust_id)
            return;

        this.current_illust_id = illust_id;
        this.current_illust_info = null;
        if(this.current_illust_id == null)
            return;

        // Get the image data.  This will often already be available.
        var illust_info = await image_data.singleton().get_image_info(this.current_illust_id);
        if(this.current_illust_id != illust_id || this.current_illust_info != null)
            return;

        // Store the illust_info for current_illust_id.
        this.current_illust_info = illust_info;

        // Preload thumbnails.
        this.preload_thumbs(illust_info);

        this.check_fetch_queue();
    }

    // Set the illust_id we want to speculatively load, which is the next or previous image in
    // the current search.  If illust_id is null, we don't want to speculatively load anything.
    async set_speculative_image(illust_id)
    {
        if(this.speculative_illust_id == illust_id)
            return;
        
        this.speculative_illust_id = illust_id;
        this.speculative_illust_info = null;
        if(this.speculative_illust_id == null)
            return;

        // Get the image data.  This will often already be available.
        var illust_info = await image_data.singleton().get_image_info(this.speculative_illust_id);
        if(this.speculative_illust_id != illust_id || this.speculative_illust_info != null)
            return;

        // Store the illust_info for current_illust_id.
        this.speculative_illust_info = illust_info;

        // Preload thumbnails.
        this.preload_thumbs(illust_info);

        this.check_fetch_queue();
    }

    // See if we need to start or stop preloads.  We do this when we have new illustration info,
    // and when a fetch finishes.
    check_fetch_queue()
    {
        // console.log("check queue:", this.current_illust_info != null, this.speculative_illust_info != null);

        // Make a list of fetches that we want to be running, in priority order.
        var wanted_preloads = [];
        if(this.current_illust_info != null)
            wanted_preloads = wanted_preloads.concat(this.create_preloaders_for_illust(this.current_illust_info));
        if(this.speculative_illust_info != null)
            wanted_preloads = wanted_preloads.concat(this.create_preloaders_for_illust(this.speculative_illust_info));

        // Remove all preloads from wanted_preloads that we've already finished recently.
        var filtered_preloads = [];
        for(var preload of wanted_preloads)
        {
            if(this.recently_preloaded_urls.indexOf(preload.url) == -1)
                filtered_preloads.push(preload);
        }

        // If we don't want any preloads, stop.  If we have any running preloads, let them continue.
        if(filtered_preloads.length == 0)
        {
            // console.log("Nothing to do");
            return;
        }

        // Discard preloads beyond the number we want to be running.  If we're loading more than this,
        // we'll start more as these finish.
        var concurrent_preloads = 5;
        filtered_preloads.splice(concurrent_preloads);
        // console.log("Preloads:", filtered_preloads.length);

        // If any preload in the list is running, stop.  We only run one preload at a time, so just
        // let it finish.
        let any_preload_running = false;
        for(let preload of filtered_preloads)
        {
            let active_preload = this._find_active_preload_by_url(preload.url);
            if(active_preload != null)
                return;
        }

        // No preloads are running, so start the highest-priority preload.
        //
        // updated_preload_list allows us to run multiple preloads at a time, but we currently
        // run them in serial.
        var unwanted_preloads;
        var updated_preload_list = [];
        for(let preload of filtered_preloads)
        {
            // Start this preload.
            // console.log("Start preload:", preload.url);
            preload.start().finally(() => {
                // Add the URL to recently_preloaded_urls, so we don't try to preload this
                // again for a while.  We do this even on error, so we don't try to load
                // failing images repeatedly.
                this.recently_preloaded_urls.push(preload.url);
                this.recently_preloaded_urls.splice(0, this.recently_preloaded_urls.length - 1000);

                // When the preload finishes (successful or not), remove it from the list.
                var idx = this.preloads.indexOf(preload);
                if(idx == -1)
                {
                    console.error("Preload finished, but we weren't running it:", preload.url);
                    return;
                }
                this.preloads.splice(idx, 1);

                // See if we need to start another preload.
                this.check_fetch_queue();
            });

            updated_preload_list.push(preload);
            break;
        }

        // Cancel preloads in this.preloads that aren't in updated_preload_list.  These are
        // preloads that we either don't want anymore, or which have been pushed further down
        // the priority queue and overridden.
        for(var preload of this.preloads)
        {
            if(updated_preload_list.indexOf(preload) != -1)
                continue;

            console.log("Cancelling preload:", preload.url);
            preload.cancel();

            // Preloads stay in the list until the cancellation completes.
            updated_preload_list.push(preload);
        }

        this.preloads = updated_preload_list;
    }

    // Return the preloader if we're currently preloading url.
    _find_active_preload_by_url(url)
    {
        for(var preload of this.preloads)
            if(preload.url == url)
                return preload;
        return null;
    }

    // Return an array of preloaders to load resources for the given illustration.
    create_preloaders_for_illust(illust_data)
    {
        // Don't precache muted images.
        if(muting.singleton.any_tag_muted(illust_data.tags.tags))
            return [];
        if(muting.singleton.is_muted_user_id(illust_data.userId))
            return [];

        // If this is a video, preload the ZIP.
        if(illust_data.illustType == 2)
        {
            var results = [];
            results.push(new _xhr_preloader(illust_data.ugoiraMetadata.originalSrc));

            // Preload the original image too, which viewer_ugoira displays if the ZIP isn't
            // ready yet.
            results.push(new _img_preloader(illust_data.urls.original));

            return results;
        }

        // Otherwise, preload the images.  Preload thumbs first, since they'll load
        // much faster.  Only preload low-res images for image viewing if low res previews
        // are enabled.
        var results = [];
        for(var page of illust_data.mangaPages)
            results.push(new _img_preloader(page.urls.small));

        // Only preload the first page, which is the main page of a regular illustration.
        // This also forces us to wait for the current image to load before preloading future
        // images, so we don't slow down loading the current image by preloading too early.
        if(illust_data.mangaPages.length >= 1)
            results.push(new _img_preloader(illust_data.mangaPages[0].urls.original));

        return results;
    }

    preload_thumbs(illust_info)
    {
        // We're only interested in preloading thumbs for manga pages.
        if(illust_info.pageCount < 2)
            return;

        // Preload thumbs directly rather than queueing, since they load quickly and
        // this reduces flicker in the manga thumbnail bar.
        var thumbs = [];
        for(var page of illust_info.mangaPages)
            thumbs.push(page.urls.small);

        helpers.preload_images(thumbs);
    }
};

