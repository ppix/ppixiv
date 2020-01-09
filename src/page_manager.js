// This handles:
//
// - Keeping track of whether we're active or not.  If we're inactive, we turn off
// and let the page run normally.
// - Storing state in the address bar.
//
// We're active by default on illustration pages, and inactive by default on others.
//
// If we're active, we'll store our state in the hash as "#ppixiv/...".  The start of
// the hash will always be "#ppixiv", so we can tell it's our data.  If we're on a page
// where we're inactive by default, this also remembers that we've been activated.
//
// If we're inactive on a page where we're active by default, we'll always put something
// other than "#ppixiv" in the address bar.  It doesn't matter what it is.  This remembers
// that we were deactivated, and remains deactivated even if the user clicks an anchor
// in the page that changes the hash.
//
// If we become active or inactive after the page loads, we refresh the page.
//
// We have two sets of query parameters: args stored in the URL query, and args stored in
// the hash.  For example, in:
//
// https://www.pixiv.net/bookmark.php?p=2#ppixiv?illust_id=1234
//
// our query args are p=2, and our hash args are illust_id=1234.  We use query args to
// store state that exists in the underlying page, and hash args to store state that
// doesn't, so the URL remains valid for the actual Pixiv page if our UI is turned off.

class page_manager
{
    constructor()
    {
        this.window_popstate = this.window_popstate.bind(this);
        window.addEventListener("popstate", this.window_popstate, true);

        this.data_sources_by_canonical_url = {};
        this.active = this._active_internal();
    };

    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(page_manager._singleton == null)
            page_manager._singleton = new page_manager();
        return page_manager._singleton;
    };

    // Return the data source for a URL, or null if the page isn't supported.
    get_data_source_for_url(url)
    {
        // url is usually document.location, which for some reason doesn't have .searchParams.
        var url = new unsafeWindow.URL(url);
        url = helpers.get_url_without_language(url);

        let first_part = helpers.get_page_type_from_url(url);

        if(first_part == "artworks")
            return data_source_current_illust;
        else if(url.pathname == "/member.php" && url.searchParams.get("id") != null)
            return data_source_artist;
        else if(url.pathname == "/member_illust.php" && url.searchParams.get("id") != null)
            return data_source_artist;
        else if(first_part == "users")
            return data_source_artist;
        else if(url.pathname == "/bookmark.php" && url.searchParams.get("type") == null)
        {
            // Handle a special case: we're called by early_controller just to find out if
            // the current page is supported or not.  This happens before window.global_data
            // exists, so we can't check if we're viewing our own bookmarks or someone else's.
            // In this case we don't need to, since the caller just wants to see if we return
            // a data source or not.
            if(window.global_data == null)
                return data_source_bookmarks;

            // If show-all=0 isn't in the hash, and we're not viewing someone else's bookmarks,
            // we're viewing all bookmarks, so use data_source_bookmarks_merged.  Otherwise,
            // use data_source_bookmarks.
            var hash_args = helpers.get_hash_args(url);
            var query_args = url.searchParams;
            var user_id = query_args.get("id");
            if(user_id == null)
                user_id = window.global_data.user_id;
            var viewing_own_bookmarks = user_id == window.global_data.user_id;
            
            var both_public_and_private = viewing_own_bookmarks && hash_args.get("show-all") != "0";
            return both_public_and_private? data_source_bookmarks_merged:data_source_bookmarks;
        }
        else if(url.pathname == "/bookmark.php" && url.searchParams.get("type") == "user")
            return data_source_follows;
        else if(url.pathname == "/new_illust.php" || url.pathname == "/new_illust_r18.php")
            return data_source_new_illust;
        else if(url.pathname == "/bookmark_new_illust.php")
            return data_source_bookmarks_new_illust;
        else if(first_part == "tags")
            return data_source_search;
        else if(url.pathname == "/discovery")
            return data_source_discovery;
        else if(url.pathname == "/discovery/users")
            return data_source_discovery_users;
        else if(url.pathname == "/bookmark_detail.php")
            return data_source_related_illusts;
        else if(url.pathname == "/ranking.php")
            return data_source_rankings;
        else
            return null;
    };

    // Create the data source for a given URL.
    //
    // If we've already created a data source for this URL, the same one will be
    // returned.
    //
    // If force is true, we'll always create a new data source, replacing any
    // previously created one.
    async create_data_source_for_url(url, doc, force)
    {
        var data_source_class = this.get_data_source_for_url(url);
        if(data_source_class == null)
        {
            console.error("Unexpected path:", url.pathname);
            return;
        }

        // Canonicalize the URL to see if we already have a data source for this URL.
        var canonical_url = await data_source_class.get_canonical_url(url);

        // console.log("url", url.toString(), "becomes", canonical_url);
        if(!force && canonical_url in this.data_sources_by_canonical_url)
        {
            // console.log("Reusing data source for", url.toString());
            return this.data_sources_by_canonical_url[canonical_url];
        }
        
        // console.log("Creating new data source for", url.toString());
        var source = new data_source_class(url.href, doc);
        this.data_sources_by_canonical_url[canonical_url] = source;
        return source;
    }

    // Return true if it's possible for us to be active on this page.
    available()
    {
        // We support the page if it has a data source.
        return this.get_data_source_for_url(document.location) != null;
    };

    window_popstate(e)
    {
        var currently_active = this._active_internal();
        if(this.active == currently_active)
            return;

        // Stop propagation, so other listeners don't see this.  For example, this prevents
        // the thumbnail viewer from turning on or off as a result of us changing the hash
        // to "#no-ppixiv".
        e.stopImmediatePropagation();

        if(this.active == currently_active)
            return;
        
        this.store_ppixiv_disabled(!currently_active);
        
        console.log("Active state changed");

        // The URL has changed and caused us to want to activate or deactivate.  Reload the
        // page.
        //
        // We'd prefer to reload with cache, like a regular navigation, but Firefox seems
        // to reload without cache no matter what we do, even though document.location.reload
        // is only supposed to bypass cache on reload(true).  There doesn't seem to be any
        // reliable workaround.
        document.location.reload();
    }

    store_ppixiv_disabled(disabled)
    {
        // Remember that we're enabled or disabled in this tab.
        if(disabled)
            window.sessionStorage.ppixiv_disabled = 1;
        else
            delete window.sessionStorage.ppixiv_disabled;
    }

    // Return true if we're active by default on the current page.
    active_by_default()
    {
        // If the disabled-by-default setting is enabled, disable by default until manually
        // turned on.
        if(settings.get("disabled-by-default"))
            return false;

        // If this is set, the user clicked the "return to Pixiv" button.  Stay disabled
        // in this tab until we're reactivated.
        if(window.sessionStorage.ppixiv_disabled)
            return false;

        return this.available();
    };

    // Return true if we're currently active.
    //
    // This is cached at the start of the page and doesn't change unless the page is reloaded.
    _active_internal()
    {
        // If the hash is empty, use the default.
        if(document.location.hash == "")
            return this.active_by_default();

        // If we have a hash and it's not #ppixiv, then we're explicitly disabled.  If we
        // # do have a #ppixiv hash, we're explicitly enabled.
        //
        // If we're explicitly enabled but aren't actually available, we're disabled.  This
        // makes sure we don't break pages if we accidentally load them with a #ppixiv hash,
        // or if we remove support for a page that people have in their browser session.
        return helpers.parse_hash(document.location) != null && this.available();
    };

    // Given a list of tags, return the URL to use to search for them.  This differs
    // depending on the current page.
    get_url_for_tag_search(tags)
    {
        let url = new URL(document.location);
        url = helpers.get_url_without_language(url);

        let type = helpers.get_page_type_from_url(url);
        if(type == "tags")
        {
            // If we're on search already, just change the search tag, so we preserve other settings.
            // /tags/tag/artworks -> /tag/new tag/artworks
            let parts = url.pathname.split("/");
            parts[2] = encodeURIComponent(tags);
            url.pathname = parts.join("/");
        } else {
            // If we're not, change to search and remove the rest of the URL.
            url = new URL("/tags/" + encodeURIComponent(tags) + "#ppixiv", document.location);
        }
        
        return url;
    }
}

