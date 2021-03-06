// This is the base class for viewer classes, which are used to view a particular
// type of content in the main display.
class viewer
{
    constructor(container, illust_data)
    {
        this.illust_data = illust_data;
    }

    // Remove any event listeners, nodes, etc. and shut down so a different viewer can
    // be used.
    shutdown() { }

    set page(page) { }
    get page() { return 0; }

    // Return the file type for display in the UI, eg. "PNG".
    get current_image_type() { return null; }

    // If an image is displayed, clear it.
    //
    // This is only used with the illust viewer when changing manga pages in cases
    // where we don't want the old image to be displayed while the new one loads.
    set hide_image(value) { }
    get hide_image() { return false; }
}

