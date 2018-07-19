// This handles fetching and caching image data and associated user data.
//
// We always load the user data for an illustration if it's not already loaded.  We also
// load ugoira_metadata.  This way, we can access all the info we need for an image in
// one place, without doing multi-phase loads elsewhere.
class image_data
{
    constructor()
    {
        this.call_pending_callbacks = this.call_pending_callbacks.bind(this);
        this.loaded_image_info = this.loaded_image_info.bind(this);
        this.load_user_info = this.load_user_info.bind(this);
        this.loaded_user_info = this.loaded_user_info.bind(this);

        // Cached data:
        this.image_data = { };
        this.user_data = { };
        this.illust_id_to_user_id = {};

        this.loading_image_data_ids = {};
        this.loading_user_data_ids = {};

        this.pending_image_info_calls = [];
        this.pending_user_info_calls = [];
    };

    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(image_data._singleton == null)
            image_data._singleton = new image_data();
        return image_data._singleton;
    };

    // Get image data.  Call callback when it's available:
    //
    // callback(image_data, user_data);
    //
    // User data for the illustration will be fetched, and returned as image_data.userInfo.
    // Note that user data can change (eg. when following a user), and all images for the
    // same user will share the same userInfo object.
    //
    // If illust_id is a video, we'll also download the metadata before returning it, and store
    // it as image_data.ugoiraMetadata.
    get_image_info(illust_id, callback)
    {
        // If callback is null, just fetch the data.
        if(callback != null)
            this.pending_image_info_calls.push([illust_id, callback]);

        this.load_image_info(illust_id);
    }

    // Just get user info.
    get_user_info(user_id, callback)
    {
        // If callback is null, just fetch the data.
        if(callback != null)
            this.pending_user_info_calls.push([user_id, callback]);

        this.load_user_info(user_id);
    }
    
    call_pending_callbacks()
    {
        // Copy the list, in case get_image_info is called from a callback.
        var callbacks = this.pending_image_info_calls.slice();
        for(var i = 0; i < this.pending_image_info_calls.length; ++i)
        {
            var pending = this.pending_image_info_calls[i];
            var illust_id = pending[0];
            var callback = pending[1];

            // Wait until we have all the info for this image.
            var illust_data = this.image_data[illust_id];
            if(illust_data == null)
                continue;

            var user_data = this.user_data[illust_data.userId];
            if(user_data == null)
                continue;

            // Make sure user_data is referenced from the image.
            illust_data.userInfo = user_data;

            // Remove the entry.
            this.pending_image_info_calls.splice(i, 1);
            --i;

            // Run the callback.
            try {
                callback(illust_data);
            } catch(e) {
                console.error(e);
            }
        }

        // Call user info callbacks.  These are simpler.
        var callbacks = this.pending_user_info_calls.slice();
        for(var i = 0; i < this.pending_user_info_calls.length; ++i)
        {
            var pending = this.pending_user_info_calls[i];
            var user_id = pending[0];
            var callback = pending[1];

            // Wait until we have all the info for this user.
            var user_data = this.user_data[user_id];
            if(user_data == null)
                continue;

            // Remove the entry.
            this.pending_user_info_calls.splice(i, 1);
            --i;

            // Run the callback.
            try {
                callback(user_data);
            } catch(e) {
                console.error(e);
            }
        }
    }

    // Load illust_id and all data that it depends on.  When it's available, call call_pending_callbacks.
    load_image_info(illust_id)
    {
        // If we have the user ID cached, start loading it without waiting for the
        // illustration data to load first.
        var cached_user_id = this.illust_id_to_user_id[illust_id];
        if(cached_user_id != null)
            this.load_user_info(cached_user_id);

        // If we're already loading this illustration, stop.
        if(this.loading_image_data_ids[illust_id])
            return;

        // If we already have this illustration, just make sure we're fetching the user.
        if(this.image_data[illust_id] != null)
        {
            this.load_user_info(this.image_data[illust_id].userId);
            return;
        }

        // console.log("Fetch illust", illust_id);
        this.loading_image_data_ids[illust_id] = true;

        // This call returns only preview data, so we can't use it to batch load data, but we could
        // use it to get thumbnails for a navigation pane:
        // helpers.rpc_get_request("/rpc/illust_list.php?illust_ids=" + illust_id, function(result) { });

        helpers.get_request("/ajax/illust/" + illust_id, {}, this.loaded_image_info);
    }

    loaded_image_info(illust_result)
    {
        if(illust_result.error)
            return;

        var illust_data = illust_result.body;
        var illust_id = illust_data.illustId;
        // console.log("Got illust", illust_id);

        // This is usually set by load_image_info, but we also need to set it if we're called by
        // add_illust_data so it's true if we fetch metadata below.
        this.loading_image_data_ids[illust_id] = true;

        var finished_loading_image_data = function()
        {
            delete this.loading_image_data_ids[illust_id];

            // Store the image data.
            this.image_data[illust_id] = illust_data;

            // Load user info for the illustration.
            //
            // Do this async rather than immediately, so if we're loading initial info with calls to
            // add_illust_data and add_user_data, we'll give the caller a chance to finish and give us
            // user info, rather than fetching it now when we won't need it.
            setTimeout(function() {
                this.load_user_info(illust_data.userId);
            }.bind(this), 0);
        }.bind(this);

        if(illust_data.illustType == 2)
        {
            // If this is a video, load metadata and add it to the illust_data before we store it.
            helpers.fetch_ugoira_metadata(illust_id, function(ugoira_result) {
                illust_data.ugoiraMetadata = ugoira_result.body;
                finished_loading_image_data();
            }.bind(this));
        }
        else
        {
            // Otherwise, we're done loading the illustration.
            finished_loading_image_data();
        }
    }

    load_user_info(user_id)
    {
        // If we're already loading this user, stop.
        if(this.loading_user_data_ids[user_id])
        {
            console.log("User " + user_id + " is already being fetched, waiting for it");
            return;
        }

        // If we already have the user info for this illustration, we're done.  Call call_pending_callbacks
        // to fire any waiting callbacks.
        if(this.user_data[user_id] != null)
        {
            setTimeout(function() {
                this.call_pending_callbacks();
            }.bind(this), 0);
            return;
        }

        // console.log("Fetch user", user_id);
        this.loading_user_data_ids[user_id] = true;
        helpers.get_request("/ajax/user/" + user_id, {}, this.loaded_user_info);
    }

    loaded_user_info(user_result)
    {
        if(user_result.error)
            return;

        var user_data = user_result.body;
        var user_id = user_data.userId;
        // console.log("Got user", user_id);
        delete this.loading_user_data_ids[user_id];

        // Store the user data.
        this.user_data[user_id] = user_data;

        this.call_pending_callbacks();
    }

    // Add image and user data to the cache that we received from other sources.  Note that if
    // we have any fetches in the air already, we'll leave them running.
    add_illust_data(illust_data)
    {
        // Call loaded_image_info directly, so we'll load video metadata, etc.
        this.loaded_image_info({
            error: false,
            body: illust_data
        });
    }

    add_user_data(user_data)
    {
        this.loaded_user_info({
            body: user_data,
        });
    }

    // When we load an image, we load the user with it, and we get the user ID from
    // the illustration data.  However, this is slow, since we have to wait for
    // the illust request to finish before we know what user to load.
    //
    // In some cases we know from other sources what user we'll need (but where we
    // don't want to load the user yet).  This can be called to cache that, so if
    // an illust is loaded, we can start the user fetch in parallel.
    set_user_id_for_illust_id(illust_id, user_id)
    {
        this.illust_id_to_user_id[illust_id] = user_id;
    }
}

