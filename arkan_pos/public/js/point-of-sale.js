try {
  class PointOfSale {
    constructor(wrapper) {
      this.wrapper = $(wrapper).find(".layout-main-section");
      this.page = wrapper.page;

      const assets = [
        "assets/erpnext/js/pos/clusterize.js",
        "assets/erpnext/css/pos.css",
      ];

      frappe.require(assets, () => {
        this.make();
      });
    }

    make() {
      return frappe.run_serially([
        () => frappe.dom.freeze(),
        () => {
          this.prepare_dom();
          this.prepare_menu();
          this.set_online_status();
        },
        () => this.make_new_invoice(),
        () => {
          if (!this.frm.doc.company) {
            this.setup_company().then((company) => {
              this.frm.doc.company = company;
              this.get_pos_profile();
            });
          }
        },
        () => {
          frappe.dom.unfreeze();
        },
        () => this.page.set_title(__("Point of Sale")),
      ]);
    }

    get_pos_profile() {
      return frappe
        .xcall("erpnext.stock.get_item_details.get_pos_profile", {
          company: this.frm.doc.company,
        })
        .then((r) => {
          if (r) {
            this.frm.doc.pos_profile = r.name;
            this.set_pos_profile_data().then(() => {
              this.on_change_pos_profile();
            });
          } else {
            this.raise_exception_for_pos_profile();
          }
        });
    }

    set_online_status() {
      this.connection_status = false;
      this.page.set_indicator(__("Offline"), "grey");
      frappe.call({
        method: "frappe.handler.ping",
        callback: (r) => {
          if (r.message) {
            this.connection_status = true;
            this.page.set_indicator(__("Online"), "green");
          }
        },
      });
    }

    raise_exception_for_pos_profile() {
      setTimeout(() => frappe.set_route("List", "POS Profile"), 2000);
      frappe.throw(__("POS Profile is required to use Point-of-Sale"));
    }

    prepare_dom() {
      this.wrapper.append(`
                <div class="pos">
                    <section class="cart-container">
    
                    </section>
                    <section class="item-container">
    
                    </section>
                </div>
            `);
    }

    make_cart() {
      this.cart = new POSCart({
        frm: this.frm,
        wrapper: this.wrapper.find(".cart-container"),
        events: {
          on_customer_change: (customer) => {
            this.frm.set_value("customer", customer);
          },
          on_field_change: (item_code, field, value, batch_no) => {
            this.update_item_in_cart(item_code, field, value, batch_no);
          },
          on_numpad: (value) => {
            if (value == __("Pay")) {
              if (!this.payment) {
                this.submit_sales_invoice();
              } else {
                this.frm.doc.payments.map((p) => {
                  this.payment.dialog.set_value(p.mode_of_payment, p.amount);
                });

                this.payment.set_title();
              }
              //this.payment.open_modal();
            }
          },
          on_select_change: () => {
            this.cart.numpad.set_inactive();
            this.set_form_action();
          },
          get_item_details: (item_code) => {
            return this.items.get(item_code);
          },
          // get_loyalty_details: () => {
          //   var me = this;
          //   if (this.frm.doc.customer) {
          //     frappe.call({
          //       method:
          //         "erpnext.accounts.doctype.loyalty_program.loyalty_program.get_loyalty_program_details_with_points",
          //       args: {
          //         customer: me.frm.doc.customer,
          //         expiry_date: me.frm.doc.posting_date,
          //         company: me.frm.doc.company,
          //         silent: true,
          //       },
          //       callback: function (r) {
          //         if (r.message.loyalty_program && r.message.loyalty_points) {
          //           me.cart.events.set_loyalty_details(r.message, true);
          //         }
          //         if (!r.message.loyalty_program) {
          //           var loyalty_details = {
          //             loyalty_points: 0,
          //             loyalty_program: "",
          //             expense_account: "",
          //             cost_center: "",
          //           };
          //           me.cart.events.set_loyalty_details(loyalty_details, false);
          //         }
          //       },
          //     });
          //   }
          // },
          // set_loyalty_details: (details, view_status) => {
          //   if (view_status) {
          //     this.cart.available_loyalty_points.$wrapper.removeClass("hide");
          //   } else {
          //     this.cart.available_loyalty_points.$wrapper.addClass("hide");
          //   }
          //   this.cart.available_loyalty_points.set_value(
          //     details.loyalty_points
          //   );
          //   this.cart.available_loyalty_points.refresh_input();
          //   this.frm.set_value("loyalty_program", details.loyalty_program);
          //   this.frm.set_value(
          //     "loyalty_redemption_account",
          //     details.expense_account
          //   );
          //   this.frm.set_value(
          //     "loyalty_redemption_cost_center",
          //     details.cost_center
          //   );
          // },
        },
      });

      frappe.ui.form.on("Sales Invoice", "selling_price_list", (frm) => {
        if (this.items && frm.doc.pos_profile) {
          this.items.reset_items();
        }
      });
    }

    toggle_editing(flag) {
      let disabled;
      if (flag !== undefined) {
        disabled = !flag;
      } else {
        disabled = this.frm.doc.docstatus == 1 ? true : false;
      }
      const pointer_events = disabled ? "none" : "inherit";

      this.wrapper.find("input, button, select").prop("disabled", disabled);
      this.wrapper.find(".number-pad-container").toggleClass("hide", disabled);

      this.wrapper
        .find(".cart-container")
        .css("pointer-events", pointer_events);
      this.wrapper
        .find(".item-container")
        .css("pointer-events", pointer_events);

      this.page.clear_actions();
    }

    make_items() {
      this.items = new POSItems({
        wrapper: this.wrapper.find(".item-container"),
        frm: this.frm,
        events: {
          update_cart: (item, field, value) => {
            if (!this.frm.doc.customer) {
              frappe.throw(__("Please select a customer"));
            }
            this.update_item_in_cart(item, field, value);
            this.cart && this.cart.unselect_all();
          },
        },
      });
    }

    update_item_in_cart(item_code, field = "qty", value = 1, batch_no) {
      frappe.dom.freeze();
      if (this.cart.exists(item_code, batch_no)) {
        const search_field = batch_no ? "batch_no" : "item_code";
        const search_value = batch_no || item_code;
        const item = this.frm.doc.items.find(
          (i) => i[search_field] === search_value
        );
        frappe.flags.hide_serial_batch_dialog = false;

        if (
          typeof value === "string" &&
          !in_list(["serial_no", "batch_no"], field)
        ) {
          // value can be of type '+1' or '-1'
          value = item[field] + flt(value);
        }

        if (field === "serial_no") {
          value = item.serial_no + "\n" + value;
        }

        // if actual_batch_qty and actual_qty if there is only one batch. In such
        // a case, no point showing the dialog
        const show_dialog = item.has_serial_no || item.has_batch_no;

        if (
          show_dialog &&
          field == "qty" &&
          ((!item.batch_no && item.has_batch_no) ||
            item.has_serial_no ||
            item.actual_batch_qty != item.actual_qty)
        ) {
          this.select_batch_and_serial_no(item);
        } else {
          this.update_item_in_frm(item, field, value).then(() => {
            frappe.dom.unfreeze();
            frappe.run_serially([
              () => {
                let items = this.frm.doc.items.map((item) => item.name);
                if (items && items.length > 0 && items.includes(item.name)) {
                  this.frm.doc.items.forEach((item_row) => {
                    // update cart
                    this.on_qty_change(item_row);
                  });
                } else {
                  this.on_qty_change(item);
                }
              },
              () => this.post_qty_change(item),
            ]);
          });
        }
        return;
      }

      let args = { item_code: item_code };
      if (in_list(["serial_no", "batch_no"], field)) {
        args[field] = value;
      }

      // add to cur_frm
      const item = this.frm.add_child("items", args);
      frappe.flags.hide_serial_batch_dialog = true;

      frappe.run_serially([
        () => {
          return this.frm.script_manager
            .trigger("item_code", item.doctype, item.name)
            .then(() => {
              this.frm.script_manager
                .trigger("qty", item.doctype, item.name)
                .then(() => {
                  frappe.run_serially([
                    () => {
                      let items = this.frm.doc.items.map((i) => i.name);
                      if (
                        items &&
                        items.length > 0 &&
                        items.includes(item.name)
                      ) {
                        this.frm.doc.items.forEach((item_row) => {
                          // update cart
                          this.on_qty_change(item_row);
                        });
                      } else {
                        this.on_qty_change(item);
                      }
                    },
                    () => this.post_qty_change(item),
                  ]);
                });
            });
        },
        () => {
          const show_dialog = item.has_serial_no || item.has_batch_no;

          // if actual_batch_qty and actual_qty if then there is only one batch. In such
          // a case, no point showing the dialog
          if (
            show_dialog &&
            field == "qty" &&
            ((!item.batch_no && item.has_batch_no) ||
              item.has_serial_no ||
              item.actual_batch_qty != item.actual_qty)
          ) {
            // check has serial no/batch no and update cart
            this.select_batch_and_serial_no(item);
          }
        },
      ]);
    }

    on_qty_change(item) {
      frappe.run_serially([() => this.update_cart_data(item)]);
    }

    post_qty_change(item) {
      this.cart.update_taxes_and_totals();
      this.cart.update_grand_total();
      this.cart.update_qty_total();
      this.cart.scroll_to_item(item.item_code);
      this.set_form_action();
    }

    select_batch_and_serial_no(row) {
      frappe.dom.unfreeze();

      erpnext.show_serial_batch_selector(
        this.frm,
        row,
        () => {
          this.frm.doc.items.forEach((item) => {
            this.update_item_in_frm(item, "qty", item.qty).then(() => {
              // update cart
              frappe.run_serially([
                () => {
                  if (item.qty === 0) {
                    frappe.model.clear_doc(item.doctype, item.name);
                  }
                },
                () => this.update_cart_data(item),
                () => this.post_qty_change(item),
              ]);
            });
          });
        },
        () => {
          this.on_close(row);
        },
        true
      );
    }

    on_close(item) {
      if (!this.cart.exists(item.item_code, item.batch_no) && item.qty) {
        frappe.model.clear_doc(item.doctype, item.name);
      }
    }

    update_cart_data(item) {
      this.cart.add_item(item);
      frappe.dom.unfreeze();
    }

    update_item_in_frm(item, field, value) {
      if (field == "qty" && value < 0) {
        frappe.msgprint(__("Quantity must be positive"));
        value = item.qty;
      } else {
        if (in_list(["qty", "serial_no", "batch"], field)) {
          item[field] = value;
          if (field == "serial_no" && value) {
            let serial_nos = value.split("\n");
            item["qty"] = serial_nos.filter((d) => {
              return d !== "";
            }).length;
          }
        } else {
          return frappe.model.set_value(item.doctype, item.name, field, value);
        }
      }

      return this.frm.script_manager
        .trigger("qty", item.doctype, item.name)
        .then(() => {
          if (field === "qty" && item.qty === 0) {
            frappe.model.clear_doc(item.doctype, item.name);
          }
        });

      return Promise.resolve();
    }

    make_payment_modal() {
      this.payment = new Payment({
        frm: this.frm,
        events: {
          submit_form: () => {
            this.submit_sales_invoice();
          },
        },
      });
    }

    savesubmit_auto(btn, callback, on_error) {
      var me = this.frm;
      return new Promise(resolve => {
        this.frm.validate_form_action("Submit");
          frappe.validated = true;
          me.script_manager.trigger("before_submit").then(function() {
            if(!frappe.validated) {
              return me.handle_save_fail(btn, on_error);
            }

            me.save('Submit', function(r) {
              if(r.exc) {
                me.handle_save_fail(btn, on_error);
              } else {
                frappe.utils.play_sound("submit");
                callback && callback();
                me.script_manager.trigger("on_submit")
                  .then(() => resolve(me));
              }
            }, btn, () => me.handle_save_fail(btn, on_error), resolve);
          });
      });
    }

    submit_sales_invoice() {
      this.savesubmit_auto().then((r) => {
        if (r && r.doc) {
          this.frm.doc.docstatus = r.doc.docstatus;
          frappe.show_alert({
            indicator: "green",
            message: __(`Sales invoice ${r.doc.name} created succesfully`),
          });

          this.toggle_editing();

          const frm = this.frm;
          frm.print_preview.lang_code = frm.doc.language;
          frm.print_preview.printit(true);

          setTimeout(() => {
            this.make_new_invoice();
          }, 1000);
        }
      });
    }

    set_primary_action_in_modal() {
      if (!this.frm.msgbox) {
        this.frm.msgbox = frappe.msgprint(
          `<a class="btn btn-primary" style="margin-right: 5px;">
                        ${__("Print")}</a>
                    <a class="btn btn-default">
                        ${__("New")}</a>`
        );

        $(this.frm.msgbox.body)
          .find(".btn-default")
          .on("click", () => {
            this.frm.msgbox.hide();
            this.make_new_invoice();
          });

        $(this.frm.msgbox.body)
          .find(".btn-primary")
          .on("click", () => {
            this.frm.msgbox.hide();
            const frm = this.frm;
            frm.print_preview.lang_code = frm.doc.language;
            frm.print_preview.printit(true);
          });
      }
    }

    change_pos_profile() {
      return new Promise((resolve) => {
        const on_submit = ({ company, pos_profile, set_as_default }) => {
          if (pos_profile) {
            this.pos_profile = pos_profile;
          }

          if (set_as_default) {
            frappe
              .call({
                method:
                  "erpnext.accounts.doctype.pos_profile.pos_profile.set_default_profile",
                args: {
                  pos_profile: pos_profile,
                  company: company,
                },
              })
              .then(() => {
                this.on_change_pos_profile();
              });
          } else {
            this.on_change_pos_profile();
          }
        };

        let me = this;

        var dialog = frappe.prompt(
          [
            {
              fieldtype: "Link",
              label: __("Company"),
              options: "Company",
              fieldname: "company",
              default: me.frm.doc.company,
              reqd: 1,
              onchange: function (e) {
                me.get_default_pos_profile(this.value).then((r) => {
                  dialog.set_value("pos_profile", r && r.name ? r.name : "");
                });
              },
            },
            {
              fieldtype: "Link",
              label: __("POS Profile"),
              options: "POS Profile",
              fieldname: "pos_profile",
              default: me.frm.doc.pos_profile,
              reqd: 1,
              get_query: () => {
                return {
                  query:
                    "erpnext.accounts.doctype.pos_profile.pos_profile.pos_profile_query",
                  filters: {
                    company: dialog.get_value("company"),
                  },
                };
              },
            },
            {
              fieldtype: "Check",
              label: __("Set as default"),
              fieldname: "set_as_default",
            },
          ],
          on_submit,
          __("Select POS Profile")
        );
      });
    }

    on_change_pos_profile() {
      return frappe.run_serially([
        () => this.make_sales_invoice_frm(),
        () => {
          this.frm.doc.pos_profile = this.pos_profile;
          this.set_pos_profile_data().then(() => {
            this.reset_cart();
            if (this.items) {
              this.items.reset_items();
            }
          });
        },
      ]);
    }

    get_default_pos_profile(company) {
      return frappe.xcall("erpnext.stock.get_item_details.get_pos_profile", {
        company: company,
      });
    }

    setup_company() {
      return new Promise((resolve) => {
        if (!this.frm.doc.company) {
          frappe.prompt(
            {
              fieldname: "company",
              options: "Company",
              fieldtype: "Link",
              label: __("Select Company"),
              reqd: 1,
            },
            (data) => {
              this.company = data.company;
              resolve(this.company);
            },
            __("Select Company")
          );
        } else {
          resolve();
        }
      });
    }

    make_new_invoice() {
      return frappe.run_serially([
        () => this.make_sales_invoice_frm(),
        () => this.set_pos_profile_data(),
        () => {
          if (this.cart) {
            this.cart.frm = this.frm;
            this.cart.reset();
          } else {
            this.make_items();
            this.make_cart();
          }
          this.toggle_editing(true);
        },
      ]);
    }

    reset_cart() {
      this.cart.frm = this.frm;
      this.cart.reset();
      this.items.reset_search_field();
    }

    make_sales_invoice_frm() {
      const doctype = "Sales Invoice";
      return new Promise((resolve) => {
        if (this.frm) {
          this.frm = get_frm(this.frm);
          if (this.company) {
            this.frm.doc.company = this.company;
          }

          resolve();
        } else {
          frappe.model.with_doctype(doctype, () => {
            this.frm = get_frm();
            resolve();
          });
        }
      });

      function get_frm(_frm) {
        const page = $("<div>");
        const frm = _frm || new frappe.ui.form.Form(doctype, page, false);
        const name = frappe.model.make_new_doc_and_get_name(doctype, true);
        frm.refresh(name);
        frm.doc.items = [];
        frm.doc.is_pos = 1;

        return frm;
      }
    }

    set_pos_profile_data() {
      if (this.company) {
        this.frm.doc.company = this.company;
      }

      if (!this.frm.doc.company) {
        return;
      }

      return new Promise((resolve) => {
        return this.frm
          .call({
            doc: this.frm.doc,
            method: "set_missing_values",
          })
          .then((r) => {
            if (!r.exc) {
              if (!this.frm.doc.pos_profile) {
                frappe.dom.unfreeze();
                this.raise_exception_for_pos_profile();
              }
              this.frm.script_manager.trigger("update_stock");
              frappe.model.set_default_values(this.frm.doc);
              this.frm.cscript.calculate_taxes_and_totals();

              if (r.message) {
                this.frm.meta.default_print_format =
                  r.message.print_format || "";
                this.frm.allow_edit_rate = r.message.allow_edit_rate;
                this.frm.allow_edit_discount = r.message.allow_edit_discount;
                this.frm.doc.campaign = r.message.campaign;
              }
            }

            resolve();
          });
      });
    }

    prepare_menu() {
      var me = this;
      this.page.clear_menu();

      // for mobile
      // this.page.add_menu_item(__("Pay"), function () {
      //
      // }).addClass('visible-xs');

      this.page.add_menu_item(__("Form View"), function () {
        frappe.model.sync(me.frm.doc);
        frappe.set_route("Form", me.frm.doc.doctype, me.frm.doc.name);
      });

      this.page.add_menu_item(__("POS Profile"), function () {
        frappe.set_route("List", "POS Profile");
      });

      this.page.add_menu_item(__("POS Settings"), function () {
        frappe.set_route("Form", "POS Settings");
      });

      this.page.add_menu_item(__("Change POS Profile"), function () {
        me.change_pos_profile();
      });
      this.page.add_menu_item(__("Close the POS"), function () {
        var voucher = frappe.model.get_new_doc("POS Closing Voucher");
        voucher.pos_profile = me.frm.doc.pos_profile;
        voucher.user = frappe.session.user;
        voucher.company = me.frm.doc.company;
        voucher.period_start_date = me.frm.doc.posting_date;
        voucher.period_end_date = me.frm.doc.posting_date;
        voucher.posting_date = me.frm.doc.posting_date;
        frappe.set_route("Form", "POS Closing Voucher", voucher.name);
      });
    }

    set_form_action() {
      if (
        this.frm.doc.docstatus == 1 ||
        (this.frm.doc.allow_print_before_pay == 1 &&
          this.frm.doc.items.length > 0)
      ) {
        this.page.set_secondary_action(__("Print"), async () => {
          if (this.frm.doc.docstatus != 1) {
            await this.frm.save();
          }

          const frm = this.frm;
          frm.print_preview.lang_code = frm.doc.language;
          frm.print_preview.printit(true);
        });
      }
      if (this.frm.doc.items.length == 0) {
        this.page.clear_secondary_action();
      }

      if (this.frm.doc.docstatus == 1) {
        this.page.set_primary_action(__("New"), () => {
          this.make_new_invoice();
        });
        this.page.add_menu_item(__("Email"), () => {
          this.frm.email_doc();
        });
      }
    }
  }
  erpnext.pos.PointOfSale = PointOfSale;
} catch (e) {
  console.log("error", e);
}
