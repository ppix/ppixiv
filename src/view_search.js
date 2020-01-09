// The search UI.
class view_search extends view
{
    constructor(container)
    {
        super(container);
        
        this.thumbs_loaded = this.thumbs_loaded.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);
        this.onwheel = this.onwheel.bind(this);
        this.onscroll = this.onscroll.bind(this);
//        this.onmousemove = this.onmousemove.bind(this);
        this.refresh_thumbnail = this.refresh_thumbnail.bind(this);
        this.refresh_images = this.refresh_images.bind(this);
        this.window_onresize = this.window_onresize.bind(this);
        this.update_from_settings = this.update_from_settings.bind(this);
        this.thumbnail_onclick = this.thumbnail_onclick.bind(this);

        this.active = false;
        this.thumbnail_templates = {};

        window.addEventListener("thumbnailsLoaded", this.thumbs_loaded);
        window.addEventListener("resize", this.window_onresize);

        this.container.addEventListener("wheel", this.onwheel, { passive: false });
//        this.container.addEventListener("mousemove", this.onmousemove);

        this.container.addEventListener("scroll", this.onscroll);
        window.addEventListener("resize", this.onscroll);

        image_data.singleton().user_modified_callbacks.register(this.refresh_ui.bind(this));

        // When a bookmark is modified, refresh the heart icon.
        image_data.singleton().illust_modified_callbacks.register(this.refresh_thumbnail);

        this.thumbnail_dimensions_style = document.createElement("style");
        document.body.appendChild(this.thumbnail_dimensions_style);
        
        // Create the avatar widget shown on the artist data source.
        this.avatar_widget = new avatar_widget({
            parent: this.container.querySelector(".avatar-container"),
            changed_callback: this.data_source_updated,
            big: true,
            mode: "dropdown",
        });
        
        // Create the tag widget used by the search data source.
        this.tag_widget = new tag_widget({
            parent: this.container.querySelector(".related-tag-list"),
            format_link: function(tag)
            {
                // The recommended tag links are already on the search page, and retain other
                // search settings.
                var url = new URL(window.location);
                url.searchParams.set("word", tag);
                url.searchParams.delete("p");
                return url.toString();
            }.bind(this),
        });

        // Don't scroll thumbnails when scrolling tag dropdowns.
        // FIXME: This works on member-tags-box, but not reliably on search-tags-box, even though
        // they seem like the same thing.
        this.container.querySelector(".member-tags-box .post-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);
        this.container.querySelector(".search-tags-box .related-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);

        // Set up hover popups.
        dropdown_menu_opener.create_handlers(this.container, [".navigation-menu-box", ".thumbnail-settings-menu-box", ".ages-box", ".popularity-box", ".type-box", ".search-mode-box", ".size-box", ".aspect-ratio-box", ".bookmarks-box", ".time-box", ".member-tags-box", ".search-tags-box"]);

        // Fill in the default value for the search page.  We don't do this in refresh_thumbnail_ui
        // since we don't want to clobber the user's edits later.  Only do this with the search box
        // on the search page, not the one in the navigation dropdown.
        var tag = new URL(document.location).searchParams.get("word");
        if(tag != null)
            this.container.querySelector(".search-page-tag-entry .search-tags").value = tag;

        // As an optimization, start loading image info on mousedown.  We don't navigate until click,
        // but this lets us start loading image info a bit earlier.
        this.container.querySelector(".thumbnails").addEventListener("mousedown", (e) => {
            if(e.button != 0)
                return;

            // Don't do this when viewing followed users, since we'll be loading the user rather than the post.
            if(this.data_source && this.data_source.search_mode == "users")
                return;

            var a = e.target.closest("a.thumbnail-link");
            if(a == null)
                return;

            if(a.dataset.illustId != null)
                image_data.singleton().get_image_info(a.dataset.illustId);
        }, true);
 
        this.container.querySelector(".refresh-search-button").addEventListener("click", this.refresh_search.bind(this));
        this.container.querySelector(".whats-new-button").addEventListener("click", this.whats_new.bind(this));
        this.container.querySelector(".thumbnails").addEventListener("click", this.thumbnail_onclick);

        var settings_menu = this.container.querySelector(".settings-menu-box > .popup-menu-box");

        menu_option.add_settings(settings_menu);

        settings.register_change_callback("thumbnail-size", () => {
                // refresh_images first to update thumbnail_dimensions_style, then call onscroll
                // to fill in images.
                this.refresh_images();
                this.onscroll();
        });

        settings.register_change_callback("theme", this.update_from_settings);
        settings.register_change_callback("disable_thumbnail_zooming", this.update_from_settings);
        settings.register_change_callback("disable_thumbnail_panning", this.update_from_settings);
        settings.register_change_callback("ui-on-hover", this.update_from_settings);
        settings.register_change_callback("no-hide-cursor", this.update_from_settings);
         
        // Create the tag dropdown for the search page input.
        new tag_search_box_widget(this.container.querySelector(".tag-search-box"));
            
        // Create the tag dropdown for the search input in the menu dropdown.
        new tag_search_box_widget(this.container.querySelector(".navigation-search-box"));

        // This IntersectionObserver is used to tell which illustrations are fully visible on screen,
        // so we can decide which page to put in the URL for data sources that use supports_start_page.
        this.visible_illusts = [];
        this.topmost_illust_observer = helpers.intersection_observer((entries) => {
            for(let entry of entries)
            {
                let thumb = entry.target;
                if(thumb.dataset.illust_id == null)
                    continue;
                if(entry.isIntersecting)
                    this.visible_illusts.push(thumb);
                else
                {
                    let idx = this.visible_illusts.indexOf(thumb);
                    if(idx != -1)
                        this.visible_illusts.splice(idx, 1);
                }
            }
            this.visible_thumbs_changed();
        }, {
            root: this.container,

            // We only want to include fully visible thumbnails.  Note that for helpers.intersection_observer
            // we need to just use "threshold" and not "thresholds".
            threshold: 1,
        });
        
        /*
         * Add a slight delay before hiding the UI.  This allows opening the UI by swiping past the top
         * of the window, without it disappearing as soon as the mouse leaves the window.  This doesn't
         * affect opening the UI.
         *
         * We're actually handling the manga UI's top-ui-box here too.
         */
        for(let box of document.querySelectorAll(".top-ui-box"))
            new hover_with_delay(box, 0, 0.25);
        
        this.update_from_settings();
        this.refresh_images();
        this.load_needed_thumb_data();
        this.refresh_whats_new_button();
    }

    // The thumbnails visible on screen have changed.
    visible_thumbs_changed()
    {
        // visible_illusts isn't in any particular order, but should always be contiguous.
        // Start at the first thumb in the list, and walk backwards through thumbs until
        // we reach one that isn't in the list.  The thumbnail display can get very long,
        // but visible_illusts is only the ones on screen.
        // Find the earliest thumb in the list.
        if(this.visible_illusts.length == 0)
            return;

        let first_thumb = this.visible_illusts[0];
        while(first_thumb != null)
        {
            let prev_thumb = first_thumb.previousElementSibling;
            if(prev_thumb == null)
                break;

            if(this.visible_illusts.indexOf(prev_thumb) == -1)
                break;

            first_thumb = prev_thumb;
        }

        // If the data source supports a start page, update the page number in the URL to reflect
        // the first visible thumb.
        if(this.data_source == null || !this.data_source.supports_start_page || first_thumb.dataset.page == null)
            return;

        main_controller.singleton.temporarily_ignore_onpopstate = true;
        try {
            let args = helpers.get_args(document.location);
            args.query.set("p", first_thumb.dataset.page);
            helpers.set_args(args, false, "viewing-page");
        } finally {
            main_controller.singleton.temporarily_ignore_onpopstate = false;
        }
    }

    window_onresize(e)
    {
        if(!this.active)
            return;

        this.refresh_images();
    }

    refresh_search()
    {
        main_controller.singleton.refresh_current_data_source();
    }
        
    // Set or clear the updates class on the "what's new" button.
    refresh_whats_new_button()
    {
        let last_viewed_version = settings.get("whats-new-last-viewed-version", 0);

        // This was stored as a string before, since it came from GM_info.script.version.  Make
        // sure it's an integer.
        last_viewed_version = parseInt(last_viewed_version);

        let new_updates = last_viewed_version < whats_new.latest_history_revision();
        helpers.set_class(this.container.querySelector(".whats-new-button"), "updates", new_updates);
    }

    whats_new()
    {
        settings.set("whats-new-last-viewed-version", whats_new.latest_history_revision());
        this.refresh_whats_new_button();

        new whats_new(document.body.querySelector(".whats-new-box"));
    }

    /* This scrolls the thumbnail when you hover over it.  It's sort of neat, but it's pretty
     * choppy, and doesn't transition smoothly when the mouse first hovers over the thumbnail,
     * causing it to pop to a new location. 
    onmousemove(e)
    {
        var thumb = e.target.closest(".thumbnail-box a");
        if(thumb == null)
            return;

        var bounds = thumb.getBoundingClientRect();
        var x = e.clientX - bounds.left;
        var y = e.clientY - bounds.top;
        x = 100 * x / thumb.offsetWidth;
        y = 100 * y / thumb.offsetHeight;

        var img = thumb.querySelector("img.thumb");
        img.style.objectPosition = x + "% " + y + "%";
    }
*/
    onwheel(e)
    {
        // Stop event propagation so we don't change images on any viewer underneath the thumbs.
        e.stopPropagation();
    };

    onscroll(e)
    {
        this.load_needed_thumb_data();
    };

    initial_refresh_ui()
    {
        if(this.data_source != null)
        {
            var ui_box = this.container.querySelector(".thumbnail-ui-box");
            this.data_source.initial_refresh_thumbnail_ui(ui_box, this);
        }
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.remove_update_listener(this.data_source_updated);

            // Store our scroll position on the data source, so we can restore it if it's
            // reactivated.  There's only one instance of thumbnail_view, so this is safe.
            this.data_source.thumbnail_view_scroll_pos = this.container.scrollTop;
        }

        // If the search mode is changing (eg. we're going from a list of illustrations to a list
        // of users), remove thumbs so we recreate them.  Otherwise, refresh_images will reuse them
        // and they can be left on the wrong display type.
        var old_search_mode = this.data_source? this.data_source.search_mode:"";
        var new_search_mode = data_source? data_source.search_mode:"";
        if(old_search_mode != new_search_mode)
        {
            var ul = this.container.querySelector("ul.thumbnails");
            while(ul.firstElementChild != null)
            {
                let node = ul.firstElementChild;
                node.remove();

                // We should be able to just remove the element and get a callback that it's no longer visible.
                // This works in Chrome since IntersectionObserver uses a weak ref, but Firefox is stupid and leaks
                // the node.
                this.topmost_illust_observer.unobserve(node);
                helpers.remove_array_element(this.visible_illusts, node);
            }
        }

        this.data_source = data_source;

        if(this.data_source == null)
            return;
        
        // If we disabled loading more pages earlier, reenable it.
        this.disable_loading_more_pages = false;

        // Listen to the data source loading new pages, so we can refresh the list.
        this.data_source.add_update_listener(this.data_source_updated);

        this.refresh_images();
        this.load_needed_thumb_data();

        this.initial_refresh_ui();
        this.refresh_ui();
    };

    restore_scroll_position()
    {
        // If we saved a scroll position when navigating away from a data source earlier,
        // restore it now.  Only do this once.
        if(this.data_source.thumbnail_view_scroll_pos != null)
        {
            this.container.scrollTop = this.data_source.thumbnail_view_scroll_pos;
            delete this.data_source.thumbnail_view_scroll_pos;
        }
        else
            this.scroll_to_top();
    }

    scroll_to_top()
    {
        this.container.scrollTop = 0;
    }

    refresh_ui()
    {
        if(!this.active)
            return;

        var element_displaying = this.container.querySelector(".displaying");
        element_displaying.hidden = this.data_source.get_displaying_text == null;
        if(this.data_source.get_displaying_text != null)
            element_displaying.innerText = this.data_source.get_displaying_text();

        helpers.set_page_title(this.data_source.page_title || "Loading...");
        
        var ui_box = this.container.querySelector(".thumbnail-ui-box");
        this.data_source.refresh_thumbnail_ui(ui_box, this);

        this.refresh_ui_for_user_id();
    };

    // Return the user ID we're viewing, or null if we're not viewing anything specific to a user.
    get viewing_user_id()
    {
        if(this.data_source == null)
            return null;
        return this.data_source.viewing_user_id;
    }

    // Call refresh_ui_for_user_info with the user_info for the user we're viewing,
    // if the user ID has changed.
    async refresh_ui_for_user_id()
    {
        // If we're viewing ourself (our own bookmarks page), hide the user-related UI.
        var initial_user_id = this.viewing_user_id;
        var user_id = initial_user_id == window.global_data.user_id? null:initial_user_id;

        var user_info = await image_data.singleton().get_user_info_full(user_id);

        // Stop if the user ID changed since we started this request, or if we're no longer active.
        if(this.viewing_user_id != initial_user_id || !this.active)
            return;

        helpers.set_icon(null, user_info);

        // Set the bookmarks link.
        var bookmarks_link = this.container.querySelector(".bookmarks-link");
        bookmarks_link.hidden = user_info == null;
        if(user_info != null)
        {
            var bookmarks_url = "/bookmark.php?id=" + user_info.userId + "&rest=show#ppixiv";
            bookmarks_link.href = bookmarks_url;
            bookmarks_link.dataset.popup = user_info? ("View " + user_info.name + "'s bookmarks"):"View bookmarks";
        }

        // Set the similar artists link.
        var similar_artists_link = this.container.querySelector(".similar-artists-link");
        similar_artists_link.hidden = user_info == null;
        if(user_info)
            similar_artists_link.href = "/discovery/users#ppixiv?user_id=" + user_info.userId;

        // Set the following link.
        var following_link = this.container.querySelector(".following-link");
        following_link.hidden = user_info == null;
        if(user_info != null)
        {
            var following_url = "/bookmark.php?id=" + user_info.userId + "&type=user#ppixiv";
            following_link.href = following_url;
            following_link.dataset.popup = user_info? ("View " + user_info.name + "'s followed users"):"View following";
        }

        // Set the webpage link.
        var webpage_url = user_info && user_info.webpage;
        var webpage_link = this.container.querySelector(".webpage-link");
        webpage_link.hidden = webpage_url == null;
        if(webpage_url != null)
            webpage_link.href = webpage_url;

        // Set the twitter link.
        var twitter_url = user_info && user_info.social && user_info.social.twitter && user_info.social.twitter.url;
        var twitter_link = this.container.querySelector(".twitter-icon");
        twitter_link.hidden = twitter_url == null;
        if(twitter_url != null)
        {
            twitter_link.href = twitter_url;
            var path = new URL(twitter_url).pathname;
            var parts = path.split("/");
            twitter_link.dataset.popup = parts.length > 1? ("@" + parts[1]):"Twitter";
        }

        // Set the pawoo link.
        var pawoo_url = user_info && user_info.social && user_info.social.pawoo && user_info.social.pawoo.url;
        var pawoo_link = this.container.querySelector(".pawoo-icon");
        pawoo_link.hidden = pawoo_url == null;
        if(pawoo_url != null)
            pawoo_link.href = pawoo_url;

        // Set the "send a message" link.
        var contact_link = this.container.querySelector(".contact-link");
        contact_link.hidden = user_info == null;
        if(user_info != null)
            contact_link.href = "/messages.php?receiver_id=" + user_info.userId;

        // Tell the context menu which user is being viewed (if we're viewing a user-specific
        // search).
        main_context_menu.get.user_info = user_info;
    }

    set active(active)
    {
        if(this._active == active)
            return;

        this._active = active;

        super.active = active;
        
        if(active)
        {
            this.initial_refresh_ui();
            this.refresh_ui();

            // Refresh the images now, so it's possible to scroll to entries, but wait to start
            // loading data to give the caller a chance to call scroll_to_illust_id(), which needs
            // to happen after refresh_images but before load_needed_thumb_data.  This way, if
            // we're showing a page far from the top, we won't load the first page that we're about
            // to scroll away from.
            this.refresh_images();

            setTimeout(function() {
                this.load_needed_thumb_data();
            }.bind(this), 0);
        }
        else
        {
            this.stop_pulsing_thumbnail();

            main_context_menu.get.user_info = null;
        }
    }

    get active()
    {
        return this._active;
    }

    data_source_updated()
    {
        this.refresh_images();
        this.load_needed_thumb_data();
        this.refresh_ui();
    }

    // Recreate thumbnail images (the actual <img> elements).
    //
    // This is done when new pages are loaded, to create the correct number of images.
    // We don't need to do this when scrolling around or when new thumbnail data is available.
    refresh_images()
    {
        // Make a list of [illust_id, page] thumbs to add.
        var images_to_add = [];
        if(this.data_source != null)
        {
            var id_list = this.data_source.id_list;
            var min_page = id_list.get_lowest_loaded_page();
            var max_page = id_list.get_highest_loaded_page();
            var items_per_page = this.data_source.estimated_items_per_page;
            for(var page = min_page; page <= max_page; ++page)
            {
                var illust_ids = id_list.illust_ids_by_page[page];
                if(illust_ids == null)
                {
                    // This page isn't loaded.  Fill the gap with items_per_page blank entries.
                    for(var idx = 0; idx < items_per_page; ++idx)
                        images_to_add.push([null, page]);
                    continue;
                }

                // Create an image for each ID.
                for(var illust_id of illust_ids)
                    images_to_add.push({id: illust_id, page: page});
            }

            // If this data source supports a start page and we started after page 1, add the "load more"
            // button at the beginning.
            //
            // The page number for this button is the same as the thumbs that follow it, not the
            // page it'll load if clicked, so scrolling to it doesn't make us think we're scrolled
            // to that page.
            if(this.data_source.initial_page > 1)
                images_to_add.splice(0, 0, { id: "special:previous-page", page: this.data_source.initial_page });
        }

        // Add thumbs.
        //
        // Most of the time we're just adding thumbs to the list.  Avoid removing or recreating
        // thumbs that aren't actually changing, which reduces flicker.
        //
        // Do this by looking for a range of thumbnails that matches a range in images_to_add.
        // If we're going to display [0,1,2,3,4,5,6,7,8,9], and the current thumbs are [4,5,6],
        // then 4,5,6 matches and can be reused.  We'll add [0,1,2,3] to the beginning and [7,8,9]
        // to the end.
        //
        // Most of the time we're just appending.  The main time that we add to the beginning is
        // the "load previous results" button.
        var ul = this.container.querySelector("ul.thumbnails");
        var next_node = ul.firstElementChild;

        // Make a dictionary of all illust IDs and pages, so we can look them up quickly.
        let images_to_add_index = {};
        for(let i = 0; i < images_to_add.length; ++i)
        {
            let entry = images_to_add[i];
            let illust_id = entry.id;
            let page = entry.page;
            let index = illust_id + "/" + page;
            images_to_add_index[index] = i;
        }

        let get_node_idx = function(node)
        {
            if(node == null)
                return null;

            let illust_id = node.dataset.illust_id;
            let page = node.dataset.page;
            let index = illust_id + "/" + page;
            return images_to_add_index[index];
        }

        // Find the first match (4 in the above example).
        let first_matching_node = next_node;
        while(first_matching_node && get_node_idx(first_matching_node) == null)
            first_matching_node = first_matching_node.nextElementSibling;

        // If we have a first_matching_node, walk forward to find the last matching node (6 in
        // the above example).
        let last_matching_node = first_matching_node;
        if(last_matching_node != null)
        {
            // Make sure the range is contiguous.  first_matching_node and all nodes through last_matching_node
            // should match a range exactly.  If there are any missing entries, stop.
            let next_expected_idx = get_node_idx(last_matching_node) + 1;
            while(last_matching_node && get_node_idx(last_matching_node.nextElementSibling) == next_expected_idx)
            {
                last_matching_node = last_matching_node.nextElementSibling;
                next_expected_idx++;
            }
        }

        // If we have a matching range, save the scroll position relative to it, so if we add
        // new elements at the top, we stay scrolled where we are.  Otherwise, just restore the
        // current scroll position.
        let save_scroll = new SaveScrollPosition(this.container);
        if(first_matching_node)
            save_scroll.save_relative_to(first_matching_node);

        // If we have a range, delete all items outside of it.  Otherwise, just delete everything.
        while(first_matching_node && first_matching_node.previousElementSibling)
            first_matching_node.previousElementSibling.remove();

        while(last_matching_node && last_matching_node.nextElementSibling)
            last_matching_node.nextElementSibling.remove();

        if(!first_matching_node && !last_matching_node)
            helpers.remove_elements(ul);

        // If we have a matching range, add any new elements before it.
        if(first_matching_node)
        {
           let first_idx = get_node_idx(first_matching_node);
           for(let idx = first_idx - 1; idx >= 0; --idx)
           {
               let entry = images_to_add[idx];
               var illust_id = entry.id;
               var page = entry.page;
               var node = this.create_thumb(illust_id, page);
               first_matching_node.insertAdjacentElement("beforebegin", node);
               first_matching_node = node;
           }
        }

        // Add any new elements after the range.  If we don't have a range, just add everything.
        let last_idx = -1;
        if(last_matching_node)
           last_idx = get_node_idx(last_matching_node);

        for(let idx = last_idx + 1; idx < images_to_add.length; ++idx)
        {
            let entry = images_to_add[idx];
            var illust_id = entry.id;
            var page = entry.page;
            var node = this.create_thumb(illust_id, page);
            ul.appendChild(node);
        }

        if(this.container.offsetWidth == 0)
            return;

        let thumbnail_size = settings.get("thumbnail-size", 4);
        thumbnail_size = thumbnail_size_slider_widget.thumbnail_size_for_value(thumbnail_size);

        this.thumbnail_dimensions_style.textContent = helpers.make_thumbnail_sizing_style(ul, ".view-search-container", {
            wide: true,
            size: thumbnail_size,
            max_columns: 5,

            // Set a minimum padding to make sure there's room for the popup text to fit between images.
            min_padding: 15,
        });

        // Restore the value of scrollTop from before we updated.  For some reason, Firefox
        // modifies scrollTop after we add a bunch of items, which causes us to scroll to
        // the wrong position, even though scrollRestoration is disabled.
        save_scroll.restore();
    }

    // Start loading data pages that we need to display visible thumbs, and start
    // loading thumbnail data for nearby thumbs.
    async load_needed_thumb_data()
    {
        // elements is a list of elements that are onscreen (or close to being onscreen).
        // We want thumbnails loaded for these, even if we need to load more thumbnail data.
        //
        // nearby_elements is a list of elements that are a bit further out.  If we load
        // thumbnail data for elements, we'll load these instead.  That way, if we scroll
        // up a bit and two more thumbs become visible, we'll load a bigger chunk.
        // That way, we make fewer batch requests instead of requesting two or three
        // thumbs at a time.

        // Make a list of pages that we need loaded, and illustrations that we want to have
        // set.
        var wanted_illust_ids = [];
        var need_thumbnail_data = false;

        var elements = this.get_visible_thumbnails(false);
        for(var element of elements)
        {
            if(element.dataset.illust_id != null)
            {
                // If this is an illustration, add it to wanted_illust_ids so we load its thumbnail
                // info.  Don't do this if it's a user.
                if(helpers.id_type(element.dataset.illust_id) == "illust")
                    wanted_illust_ids.push(element.dataset.illust_id);
            }
        }


        // We load pages when the last thumbs on the previous page are loaded, but the first
        // time through there's no previous page to reach the end of.  Always make sure the
        // first page is loaded (usually page 1).
        let load_page = null;
        let first_page = this.data_source? this.data_source.initial_page:1;
        if(this.data_source && !this.data_source.is_page_loaded_or_loading(first_page))
            load_page = first_page;

        // If the last thumb in the list is being loaded, we need the next page to continue.
        // Note that since get_visible_thumbnails returns thumbs before they actually scroll
        // into view, this will happen before the last thumb is actually visible to the user.
        var ul = this.container.querySelector("ul.thumbnails");
        if(elements.length > 0 && elements[elements.length-1] == ul.lastElementChild)
        {
            let last_element = elements[elements.length-1];
            load_page = parseInt(last_element.dataset.page)+1;
        }

        if(load_page != null)
        {
            console.log("Load page", load_page, "for thumbnails");

            var result = await this.data_source.load_page(load_page);

            // If this page didn't load, it probably means we've reached the end, so stop trying
            // to load more pages.
            if(!result)
            {
                this.disable_loading_more_pages = true;

                // If this is the first page and there are no results, then there are no images
                // for this search.
                if(load_page == 1)
                {
                    console.log("No results on page 1.  Showing no results");
                    message_widget.singleton.show("No results");
                    message_widget.singleton.center();
                    message_widget.singleton.clear_timer();
                }
            }
        }

        if(!thumbnail_data.singleton().are_all_ids_loaded_or_loading(wanted_illust_ids))
        {
            // At least one visible thumbnail needs to be loaded, so load more data at the same
            // time.
            var nearby_elements = this.get_visible_thumbnails(true);

            var nearby_illust_ids = [];
            for(var element of nearby_elements)
            {
                if(element.dataset.illust_id == null)
                    continue;
                nearby_illust_ids.push(element.dataset.illust_id);
            }

            // console.log("Wanted:", wanted_illust_ids.join(", "));
            // console.log("Nearby:", nearby_illust_ids.join(", "));

            // Load the thumbnail data if needed.
            thumbnail_data.singleton().get_thumbnail_info(nearby_illust_ids);
        }
        
        this.set_visible_thumbs();
    }

    // Handle clicks on the "load previous results" button.
    async thumbnail_onclick(e)
    {
        let thumb = e.target.closest(".thumbnail-load-previous");
        if(thumb == null)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        let min_page = this.data_source.id_list.get_lowest_loaded_page();
        if(min_page == 1)
        {
            console.log("Already at page 1, load previous button shouldn't have been visible");
            return;
        }

        let load_page = min_page - 1;
        console.log("Loading previous page:", load_page);
        await this.data_source.load_page(load_page);
    }

    update_from_settings()
    {
        var thumbnail_mode = helpers.get_value("thumbnail-size");
        this.set_visible_thumbs();
        this.refresh_images();

        helpers.set_class(document.body, "light", settings.get("theme") == "light");
        helpers.set_class(document.body, "disable-thumbnail-panning", settings.get("disable_thumbnail_panning"));
        helpers.set_class(document.body, "disable-thumbnail-zooming", settings.get("disable_thumbnail_zooming"));
        helpers.set_class(document.body, "ui-on-hover", settings.get("ui-on-hover"));

        // Flush the top UI transition, so it doesn't animate weirdly when toggling ui-on-hover.
        for(let box of document.querySelectorAll(".top-ui-box"))
        {
            box.classList.add("disable-transition");
            box.offsetHeight;
            box.classList.remove("disable-transition");
        }
    }

    // Set the URL for all loaded thumbnails that are onscreen.
    //
    // This won't trigger loading any data (other than the thumbnails themselves).
    set_visible_thumbs()
    {
        // Make a list of IDs that we're assigning.
        var elements = this.get_visible_thumbnails();
        var illust_ids = [];
        for(var element of elements)
        {
            if(element.dataset.illust_id == null)
                continue;
            illust_ids.push(element.dataset.illust_id);
        }        

        for(var element of elements)
        {
            var illust_id = element.dataset.illust_id;
            if(illust_id == null)
                continue;

            var search_mode = this.data_source.search_mode;

            let thumb_type = helpers.id_type(illust_id);
            let thumb_id = helpers.actual_id(illust_id);
            let thumb_data = {};

            // For illustrations, get thumbnail info.  If we don't have it yet, skip the image (leave it pending)
            // and we'll come back once we have it.
            if(thumb_type == "illust")
            {
                // Get thumbnail info.
                var info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
                if(info == null)
                    continue;
            }
            
            // Leave it alone if it's already been loaded.
            if(!("pending" in element.dataset))
                continue;

            // Why is this not working in FF?  It works in the console, but not here.  Sandboxing
            // issue?
            // delete element.dataset.pending;
            element.removeAttribute("data-pending");

            if(thumb_type == "user")
            {
                // This is a user thumbnail rather than an illustration thumbnail.  It just shows a small subset
                // of info.
                let user_id = helpers.actual_id(illust_id);

                var link = element.querySelector("a.thumbnail-link");
                link.href = "/member_illust.php?id=" + user_id + "#ppixiv";

                link.dataset.userId = user_id;

                let quick_user_data = thumbnail_data.singleton().get_quick_user_data(user_id);
                if(quick_user_data == null)
                {
                    // We should always have this data for users if the data source asked us to display this user.
                    throw "Missing quick user data for user ID " + user_id;
                }
                
                var thumb = element.querySelector(".thumb");
                thumb.src = quick_user_data.profileImageUrl;

                var label = element.querySelector(".thumbnail-label");
                label.hidden = false;
                label.querySelector(".label").innerText = quick_user_data.userName;

                // Point the "similar illustrations" thumbnail button to similar users for this result, so you can
                // chain from one set of suggested users to another.
                element.querySelector("A.similar-illusts-button").href = "/discovery/users#ppixiv?user_id=" + user_id;
                continue;
            }

            if(illust_id == "special:previous-page")
            {
                // Set the link for previous-page.  Most of the time this is handled by our in-page click handler.
                let args = helpers.get_args(document.location);
                args.query.set("p", parseInt(element.dataset.page)-1);
                element.querySelector("a.load-previous-page-link").href = helpers.get_url_from_args(args);
                continue;
            }

            if(thumb_type != "illust")
                throw "Unexpected thumb type: " + thumb_type;

            // Set this thumb.
            var url = info.url;
            var thumb = element.querySelector(".thumb");

            // Check if this illustration is muted (blocked).
            var muted_tag = muting.singleton.any_tag_muted(info.tags);
            var muted_user = muting.singleton.is_muted_user_id(info.userId);
            if(muted_tag || muted_user)
            {
                element.classList.add("muted");

                // The image will be obscured, but we still shouldn't load the image the user blocked (which
                // is something Pixiv does wrong).  Load the user profile image instead.
                thumb.src = info.profileImageUrl;

                element.querySelector(".muted-label").textContent = muted_tag? muted_tag:info.userName;

                // We can use this if we want a "show anyway' UI.
                thumb.dataset.mutedUrl = url;
            }
            else
            {
                thumb.src = url;

                // The search page thumbs are always square (aspect ratio 1).
                helpers.set_thumbnail_panning_direction(element, info.width, info.height, 1);
            }

            // Set the link.  Setting dataset.illustId will allow this to be handled with in-page
            // navigation, and the href will allow middle click, etc. to work normally.
            //
            // If we're on the followed users page, set these to the artist page instead.
            var link = element.querySelector("a.thumbnail-link");
            if(search_mode == "users") {
                link.href = "/member_illust.php?id=" + info.userId + "#ppixiv";
            }
            else
            {
                link.href = "/artworks/" + illust_id + "#ppixiv";
            }

            link.dataset.illustId = illust_id;
            link.dataset.userId = info.userId;

            // Don't show this UI when we're in the followed users view.
            if(search_mode == "illusts")
            {
                if(info.illustType == 2)
                    element.querySelector(".ugoira-icon").hidden = false;

                if(info.pageCount > 1)
                {
                    var pageCountBox = element.querySelector(".page-count-box");
                    pageCountBox.hidden = false;
                    pageCountBox.href = link.href + "?view=manga";
                    element.querySelector(".page-count-box .page-count").textContent = info.pageCount;
                }

            }

            helpers.set_class(element, "dot", helpers.tags_contain_dot(info));

            // On most pages, the suggestions button in thumbnails shows similar illustrations.  On following,
            // show similar artists instead.
            if(search_mode == "users")
                element.querySelector("A.similar-illusts-button").href = "/discovery/users#ppixiv?user_id=" + info.userId;
            else
                element.querySelector("A.similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

            this.refresh_bookmark_icon(element);

            // Set the label.  This is only actually shown in following views.
            var label = element.querySelector(".thumbnail-label");
            if(search_mode == "users") {
                label.hidden = false;
                label.querySelector(".label").innerText = info.userName;
            } else {
                label.hidden = true;
            }
        }        
    }

    // Refresh the thumbnail for illust_id.
    //
    // This is used to refresh the bookmark icon when changing a bookmark.
    refresh_thumbnail(illust_id)
    {
        var ul = this.container.querySelector("ul.thumbnails");
        var thumbnail_element = ul.querySelector("[data-illust_id=\"" + illust_id + "\"]");
        if(thumbnail_element == null)
            return;
        this.refresh_bookmark_icon(thumbnail_element);
    }

    // Set the bookmarked heart for thumbnail_element.  This can change if the user bookmarks
    // or un-bookmarks an image.
    refresh_bookmark_icon(thumbnail_element)
    {
        if(this.data_source && this.data_source.search_mode == "users")
            return;

        var illust_id = thumbnail_element.dataset.illust_id;
        if(illust_id == null)
            return;

        // Get thumbnail info.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info == null)
            return;

        var show_bookmark_heart = thumbnail_info.bookmarkData != null;
        if(this.data_source != null && !this.data_source.show_bookmark_icons)
            show_bookmark_heart = false;
        
        thumbnail_element.querySelector(".heart.public").hidden = !show_bookmark_heart || thumbnail_info.bookmarkData.private;
        thumbnail_element.querySelector(".heart.private").hidden = !show_bookmark_heart || !thumbnail_info.bookmarkData.private;
    }

    // Return a list of thumbnails that are either visible, or close to being visible
    // (so we load thumbs before they actually come on screen).
    //
    // If extra is true, return more offscreen thumbnails.
    get_visible_thumbnails(extra)
    {
        // If the container has a zero height, that means we're hidden and we don't want to load
        // thumbnail data at all.
        if(this.container.offsetHeight == 0)
            return [];

        // We'll load thumbnails when they're within this number of pixels from being onscreen.
        var threshold = 450;

        var ul = this.container.querySelector("ul.thumbnails");
        var elements = [];
        var bounds_top = this.container.scrollTop - threshold;
        var bounds_bottom = this.container.scrollTop + this.container.offsetHeight + threshold;
        for(var element = ul.firstElementChild; element != null; element = element.nextElementSibling)
        {
            if(element.offsetTop + element.offsetHeight < bounds_top)
                continue;
            if(element.offsetTop > bounds_bottom)
                continue;
            elements.push(element);
        }

        if(extra)
        {
            // Expand the list outwards to include more thumbs.
            var expand_by = 20;
            var expand_upwards = true;
            while(expand_by > 0)
            {
                if(!elements[0].previousElementSibling && !elements[elements.length-1].nextElementSibling)
                {
                    // Stop if there's nothing above or below our results to add.
                    break;
                }

                if(!expand_upwards && elements[0].previousElementSibling)
                {
                    elements.unshift(elements[0].previousElementSibling);
                    expand_by--;
                }
                else if(expand_upwards && elements[elements.length-1].nextElementSibling)
                {
                    elements.push(elements[elements.length-1].nextElementSibling);
                    expand_by--;
                }

                expand_upwards = !expand_upwards;
            }
        }
        return elements;
    }

    // Create a thumb placeholder.  This doesn't load the image yet.
    //
    // illust_id is the illustration this will be if it's displayed, or null if this
    // is a placeholder for pages we haven't loaded.  page is the page this illustration
    // is on (whether it's a placeholder or not).
    create_thumb(illust_id, page)
    {
        let template_type = ".template-thumbnail";
        if(illust_id == "special:previous-page")
            template_type = ".template-load-previous-results";

        // Cache a reference to the thumbnail template.  We can do this a lot, and this
        // query takes a lot of page setup time if we run it for each thumb.
        if(this.thumbnail_templates[template_type] == null)
            this.thumbnail_templates[template_type] = document.body.querySelector(template_type);
            
        let entry = helpers.create_from_template(this.thumbnail_templates[template_type]);

        // Mark that this thumb hasn't been filled in yet.
        entry.dataset.pending = true;

        if(illust_id != null)
            entry.dataset.illust_id = illust_id;

        entry.dataset.page = page;
        this.topmost_illust_observer.observe(entry);
        return entry;
    }

    // This is called when thumbnail_data has loaded more thumbnail info.
    thumbs_loaded(e)
    {
        this.set_visible_thumbs();
    }

    // Scroll to illust_id if it's available.  This is called when we display the thumbnail view
    // after coming from an illustration.
    scroll_to_illust_id(illust_id)
    {
        var thumb = this.container.querySelector("li[data-illust_id='" + illust_id + "']");
        if(thumb == null)
            return;

        // If the item isn't visible, center it.
        var scroll_pos = this.container.scrollTop;
        if(thumb.offsetTop < scroll_pos || thumb.offsetTop + thumb.offsetHeight > scroll_pos + this.container.offsetHeight)
            this.container.scrollTop = thumb.offsetTop + thumb.offsetHeight/2 - this.container.offsetHeight/2;
    };

    pulse_thumbnail(illust_id)
    {
        var thumb = this.container.querySelector("li[data-illust_id='" + illust_id + "']");
        if(thumb == null)
            return;

        this.stop_pulsing_thumbnail();

        this.flashing_image = thumb;
        thumb.classList.add("flash");
    };

    // Work around a bug in CSS animations: even if animation-iteration-count is 1,
    // the animation will play again if the element is hidden and displayed again, which
    // causes previously-flashed thumbnails to flash every time we exit and reenter
    // thumbnails.
    stop_pulsing_thumbnail()
    {
        if(this.flashing_image == null)
            return;

        this.flashing_image.classList.remove("flash");
        this.flashing_image = null;
    };
};

